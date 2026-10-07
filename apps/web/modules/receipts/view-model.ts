import { formatUnits } from "@tally/core";
import { tokenSymbol } from "../../lib/tickers";
import { openStore, type Latest, type SnapshotStore } from "@tally/modkit";
import {
  HINT_KIND,
  RECEIPTS_KIND,
  RECEIPT_MAX_AGE_MS,
  receiptShares,
  selectReceiptHints,
  type StoredHint,
  type StoredReceipt,
  type ReceiptStatus,
} from "@tally/mod-receipts";

/** What the receipts view model needs from a registry snapshot to name a token's issuer: an address and who issues it. */
export interface RegistryToken {
  address: string;
  issuer: "ondo" | "bstock" | "xstocks";
}
export interface Freshness {
  stale: boolean;
  ageMs: number | null;
  source: string | null;
  reason: string | null;
  error: string | null;
}
export interface ReceiptVM extends Freshness {
  state: "ready" | "pending" | "empty" | "error" | "disabled";
  txHash: string;
  /** Additive. When this receipt (or its hint) was last observed, ISO 8601; null when unknown. */
  observedAt?: string | null;
  intentId: string | null;
  ticker: string | null;
  user: string | null;
  kind: "swap" | "approval" | "sell" | "stock_approval" | null;
  status: ReceiptStatus | null;
  /** Additive. The token's symbol (for example NVDAB), or null when the issuer or ticker is not known. Never guessed. */
  symbol?: string | null;
  /** Additive. Who issues the token: from the verified stock address against the registry snapshot, else from the browser hint. */
  issuer?: "ondo" | "bstock" | "xstocks" | null;
  /** Additive. "verified" when the issuer came from the registry, "client-hint" when only the browser said so, null when unknown. */
  issuerTrust?: "verified" | "client-hint" | null;
  ladder: {
    stage: "Quoted" | "Simulated" | "Received";
    tokens: string | null;
    shares: string | null;
    /** Additive. What the `tokens` field of this stage holds: stock tokens or USDT. Absent when the stage has no amount. */
    unit?: "tokens" | "usdt";
    reason: string | null;
    source: string;
  }[];
  signedMinimumShares: string | null;
  diffVsQuoteBps: number | null;
  diffVsSimBps: number | null;
  provenance: string;
  comparisonTrust: "client-hint" | "recorded" | null;
  evidence: {
    block: string | null;
    gasLimit: string | null;
    gasUsed: string | null;
    guard: string | null;
    inputSelector: string | null;
    multiplier: string | null;
    observationId: string | null;
    logIndices: number[];
    notes: string[];
    explorerUrl: string | null;
  };
}
export interface ActivityVM extends Freshness {
  state: "ready" | "empty" | "error" | "disabled";
  items: ReceiptVM[];
  pendingCount: number;
  wallet: string | null;
  truncated: boolean;
}
export type ReceiptsViewModel = ActivityVM;
export interface ReceiptLoadOptions {
  store?: SnapshotStore;
  now?: number;
  enabled?: boolean;
  onWarn?: (message: string) => void;
}
const empty = (
  hash: string,
  state: ReceiptVM["state"] = "empty",
  reason = "Receipt has no observations yet.",
): ReceiptVM => ({
  state,
  txHash: hash,
  observedAt: null,
  intentId: null,
  ticker: null,
  symbol: null,
  issuer: null,
  issuerTrust: null,
  user: null,
  kind: null,
  status: null,
  stale: false,
  ageMs: null,
  source: null,
  reason,
  error: state === "error" ? reason : null,
  ladder: [],
  signedMinimumShares: null,
  diffVsQuoteBps: null,
  diffVsSimBps: null,
  provenance: "No verified chain evidence",
  comparisonTrust: null,
  evidence: {
    block: null,
    gasLimit: null,
    gasUsed: null,
    guard: null,
    inputSelector: null,
    multiplier: null,
    observationId: null,
    logIndices: [],
    notes: [],
    explorerUrl: /^0x[\da-f]{64}$/i.test(hash) ? `https://bscscan.com/tx/${hash}` : null,
  },
});
/** Registry snapshots the flow module writes; the address-to-issuer map never changes meaning, so a stale one still names an issuer. */
function readRegistry(store: SnapshotStore, now: number): RegistryToken[] {
  const week = 7 * 86_400_000;
  for (const kind of ["radar-registry", "flow-registry"])
    try {
      const row = store.latest<RegistryToken[]>(kind, "bsc", { maxAgeMs: week, now });
      if (row?.data.length) return row.data;
    } catch {
      /* the registry is optional: without it the issuer falls back to the browser hint */
    }
  return [];
}
function issuerOf(
  verifiedStock: string | null | undefined,
  hintQuote: { stock: string; issuer: "ondo" | "bstock" } | null | undefined,
  registry: readonly RegistryToken[],
): Pick<ReceiptVM, "issuer" | "issuerTrust"> {
  const hit = verifiedStock
    ? registry.find((t) => t.address.toLowerCase() === verifiedStock.toLowerCase())
    : undefined;
  if (hit) return { issuer: hit.issuer, issuerTrust: "verified" };
  if (hintQuote) return { issuer: hintQuote.issuer, issuerTrust: "client-hint" };
  return { issuer: null, issuerTrust: null };
}
function receiptToken(
  ticker: string | null,
  verifiedStock: string | null | undefined,
  hintQuote: { stock: string; issuer: "ondo" | "bstock" } | null | undefined,
  registry: readonly RegistryToken[],
): Pick<ReceiptVM, "symbol" | "issuer" | "issuerTrust"> {
  const who = issuerOf(verifiedStock, hintQuote, registry);
  return { ...who, symbol: ticker && who.issuer ? tokenSymbol(ticker, who.issuer) : null };
}
export function receiptVM(
  snapshot: Latest<StoredReceipt>,
  registry: readonly RegistryToken[] = [],
): ReceiptVM {
  const d = snapshot.data,
    r = d.receipt,
    result = d.result;
  const status =
    result?.status ??
    (!d.chainReceipt
      ? "PENDING"
      : d.chainReceipt.status === "reverted"
        ? "FAILED"
        : d.kind === "approval"
          ? "RECONCILED"
          : "UNRECONCILED");
  const vm = empty(snapshot.key, status === "PENDING" ? "pending" : "ready");
  const quote = r?.quote;
  const receivedTokens = d.verifiedFill?.tokens ?? result?.tokensReceived;
  const receivedShares = d.verifiedFill?.shares ?? result?.sharesReceived;
  const qConversion =
    d.hint.quote && "multiplier" in d.hint.quote && d.hint.quote.multiplier != null
      ? {
          multiplier: BigInt(d.hint.quote.multiplier),
          tokenDecimals: 18,
          source: "untrusted-browser-hint",
          observationId: "client-hint",
          observedAt: null,
          observedAtReason: "Client reported",
        }
      : r?.conversion;
  return {
    ...vm,
    observedAt: new Date(snapshot.observedAt).toISOString(),
    status,
    kind: d.kind,
    intentId: d.hint.intentId,
    ticker: r?.intent.ticker ?? null,
    ...receiptToken(
      r?.intent.ticker ?? null,
      result?.guarded?.stock ?? (d.kind === "sell" ? r?.intent.spend.asset : r?.intent.asset),
      d.hint.quote,
      registry,
    ),
    user: d.transaction.sender,
    stale: snapshot.stale,
    ageMs: snapshot.ageMs,
    source: snapshot.source,
    reason:
      status === "RECONCILED_WITH_DIFFERENCE" && !r?.simulation
        ? "Received amount differs from the quote. This is a normal fill difference; no simulation output was recorded."
        : status === "PENDING"
          ? (d.pendingReason ?? "Awaiting a mined receipt; transaction hash retained")
          : d.kind === "approval"
            ? "USDT approval confirmed; no stock fill"
            : d.kind === "stock_approval"
              ? "Stock approval confirmed; no sale fill"
              : status === "UNRECONCILED"
                ? (result?.notes.at(-1) ?? d.pendingReason ?? "Evidence incomplete")
                : d.kind === "sell" && status === "RECONCILED"
                  ? `Sold ${formatUnits(result?.tokensSpent ?? 0n, 18)} tokens for ${formatUnits(result?.tokensReceived ?? 0n, 18)} USDT.`
                  : null,
    signedMinimumShares:
      d.kind === "sell"
        ? d.hint.quote && "minUsdtOut" in d.hint.quote && d.hint.quote.minUsdtOut
          ? `${formatUnits(BigInt(d.hint.quote.minUsdtOut), 18)} USDT (client-reported floor)`
          : null
        : r
          ? formatUnits(r.intent.minShares, 18)
          : null,
    diffVsQuoteBps: result?.diffVsQuoteBps ?? null,
    diffVsSimBps: result?.diffVsSimBps ?? null,
    comparisonTrust: d.baselineTrust,
    provenance: `${snapshot.source}; last verified ${new Date(d.verifiedAt).toISOString()}; ${d.baselineTrust === "client-hint" ? "quote is client-reported" : "recorded comparison"}`,
    ladder:
      d.kind === "approval" || d.kind === "stock_approval"
        ? []
        : d.kind === "sell"
          ? [
              {
                stage: "Quoted",
                unit: "tokens",
                tokens:
                  d.hint.quote && "tokensIn" in d.hint.quote
                    ? formatUnits(BigInt(d.hint.quote.tokensIn), 18)
                    : null,
                shares: null,
                source:
                  d.baselineTrust === "client-hint" ? "client-reported quote" : "recorded quote",
                reason: r?.quoteMissingReason ?? null,
              },
              {
                stage: "Simulated",
                tokens: null,
                shares: null,
                source: "unavailable",
                reason: "Sell does not record simulation output",
              },
              {
                stage: "Received",
                unit: "usdt",
                tokens:
                  receivedTokens === null || receivedTokens === undefined
                    ? null
                    : formatUnits(receivedTokens, 18),
                shares:
                  receivedShares === null || receivedShares === undefined
                    ? null
                    : formatUnits(receivedShares, 18),
                source: snapshot.source,
                reason:
                  receivedTokens == null
                    ? "No reconciled stock tokens spent"
                    : receivedShares == null
                      ? "Shares unavailable; engine multiplier could not be determined at verification time"
                      : null,
              },
            ]
          : [
              {
                stage: "Quoted",
                unit: "tokens",
                tokens: quote
                  ? formatUnits(quote.expectedOut.raw, quote.expectedOut.decimals)
                  : null,
                shares:
                  quote && qConversion
                    ? formatUnits(receiptShares(quote.expectedOut.raw, qConversion), 18)
                    : null,
                source:
                  d.baselineTrust === "client-hint" ? "client-reported quote" : "recorded quote",
                reason: r?.quoteMissingReason ?? null,
              },
              {
                stage: "Simulated",
                unit: "tokens",
                tokens: r?.simulation
                  ? formatUnits(r.simulation.expectedOut.raw, r.simulation.expectedOut.decimals)
                  : null,
                shares:
                  r?.simulation && r.conversion
                    ? formatUnits(receiptShares(r.simulation.expectedOut.raw, r.conversion), 18)
                    : null,
                source: r?.simulation?.source ?? "unavailable",
                reason: r?.simulationMissingReason ?? null,
              },
              {
                stage: "Received",
                unit: "tokens",
                tokens:
                  receivedTokens === null || receivedTokens === undefined
                    ? null
                    : formatUnits(receivedTokens, r?.intent.tokenDecimals ?? 18),
                shares:
                  receivedShares === null || receivedShares === undefined
                    ? null
                    : formatUnits(receivedShares, 18),
                source: snapshot.source,
                reason: receivedShares == null ? "No reconciled stock output available" : null,
              },
            ],
    evidence: {
      ...vm.evidence,
      block: d.chainReceipt?.blockNumber.toString() ?? null,
      gasLimit: d.transaction.gasLimit.toString(),
      gasUsed: d.chainReceipt?.gasUsed.toString() ?? null,
      guard: r?.intent.guard ?? (d.kind === "swap" ? d.transaction.destination : null),
      inputSelector: d.transaction.inputSelector,
      multiplier: r?.conversion?.multiplier.toString() ?? null,
      observationId: r?.conversion?.observationId ?? null,
      logIndices: d.chainReceipt?.logs.map((l) => l.logIndex) ?? [],
      notes: result?.notes ?? [],
    },
  };
}
export function hintVM(
  snapshot: Latest<StoredHint>,
  registry: readonly RegistryToken[] = [],
): ReceiptVM {
  const quote = snapshot.data.hint.quote;
  return {
    ...empty(snapshot.data.hint.txHash, "pending", snapshot.data.reason),
    // A hint is the browser's word only: its issuer is never "verified", whatever the registry says.
    ...receiptToken(snapshot.data.hint.ticker, null, quote, registry),
    observedAt: new Date(snapshot.observedAt).toISOString(),
    status: "PENDING",
    intentId: snapshot.data.hint.intentId,
    ticker: snapshot.data.hint.ticker,
    user: snapshot.data.hint.user,
    stale: snapshot.stale,
    ageMs: snapshot.ageMs,
    source: snapshot.source,
    provenance: "Untrusted browser hint; chain evidence not yet verified",
  };
}
export async function loadReceipt(
  hash: string,
  options: ReceiptLoadOptions = {},
): Promise<ReceiptVM> {
  if (!(options.enabled ?? process.env.FEATURE_RECEIPTS === "1"))
    return empty(hash, "disabled", "Receipts disabled");
  if (!/^0x[\da-f]{64}$/i.test(hash)) return empty(hash, "error", "Invalid transaction hash");
  let owned: ReturnType<typeof openStore> | undefined;
  try {
    const store = options.store ?? (owned = openStore());
    const now = options.now ?? Date.now();
    const key = hash.toLowerCase();
    const snapshot = store.latest<StoredReceipt>(RECEIPTS_KIND, key, {
      maxAgeMs: RECEIPT_MAX_AGE_MS,
      now,
    });
    const registry = readRegistry(store, now);
    if (snapshot) return receiptVM(snapshot, registry);
    const hint = selectReceiptHints(
      store.listLatest<StoredHint>(HINT_KIND, { maxAgeMs: RECEIPT_MAX_AGE_MS, now, limit: 1000 }),
      now,
    ).find((s) => s.data.hint.txHash === key);
    return hint ? hintVM(hint, registry) : empty(key);
  } catch {
    (options.onWarn ?? console.warn)("Receipt snapshot unavailable; details withheld");
    return empty(hash, "error", "Snapshot store unavailable");
  } finally {
    owned?.close();
  }
}
export async function loadReceipts(
  options: ReceiptLoadOptions & { wallet?: string } = {},
): Promise<ActivityVM> {
  const vm: ActivityVM = {
    state: "empty",
    items: [],
    pendingCount: 0,
    wallet: options.wallet ?? null,
    truncated: false,
    stale: false,
    ageMs: null,
    source: null,
    reason: "Receipts has no observations yet.",
    error: null,
  };
  if (!(options.enabled ?? process.env.FEATURE_RECEIPTS === "1"))
    return { ...vm, state: "disabled", reason: "Receipts disabled" };
  let owned: ReturnType<typeof openStore> | undefined;
  try {
    const store = options.store ?? (owned = openStore());
    const now = options.now ?? Date.now();
    const opts = { maxAgeMs: RECEIPT_MAX_AGE_MS, now, limit: 1000 };
    const receipts = store.listLatest<StoredReceipt>(RECEIPTS_KIND, opts),
      hints = store.listLatest<StoredHint>(HINT_KIND, opts);
    const registry = readRegistry(store, now);
    const items = new Map(receipts.map((s) => [s.key, receiptVM(s, registry)]));
    const walletHints = options.wallet
      ? hints.filter((h) => h.data.hint.user.toLowerCase() === options.wallet!.toLowerCase())
      : hints;
    for (const h of selectReceiptHints(walletHints, now))
      if (!items.has(h.data.hint.txHash)) items.set(h.data.hint.txHash, hintVM(h, registry));
    const list = [...items.values()].filter(
      (r) => !options.wallet || r.user?.toLowerCase() === options.wallet.toLowerCase(),
    );
    return {
      ...vm,
      state: list.length ? "ready" : "empty",
      items: list,
      pendingCount: list.filter((r) => r.status === "PENDING").length,
      truncated: receipts.length === 1000 || hints.length === 1000,
      stale: list.some((r) => r.stale),
      ageMs: list.length ? Math.max(...list.map((r) => r.ageMs ?? 0)) : null,
      source: list.length ? [...new Set(list.map((r) => r.source))].join(", ") : null,
      reason: list.length ? null : vm.reason,
    };
  } catch {
    (options.onWarn ?? console.warn)("Activity snapshot unavailable; details withheld");
    return {
      ...vm,
      state: "error",
      error: "Snapshot store unavailable",
      reason: "Activity could not load",
    };
  } finally {
    owned?.close();
  }
}
