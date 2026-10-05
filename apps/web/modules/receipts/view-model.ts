import { formatUnits } from "@tally/core";
import { openStore, type Latest, type SnapshotStore } from "@tally/modkit";
import {
  HINT_KIND,
  RECEIPTS_KIND,
  RECEIPT_MAX_AGE_MS,
  receiptShares,
  type StoredHint,
  type StoredReceipt,
  type ReceiptStatus,
} from "@tally/mod-receipts";

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
  intentId: string | null;
  ticker: string | null;
  user: string | null;
  kind: "swap" | "approval" | null;
  status: ReceiptStatus | null;
  ladder: {
    stage: "Quoted" | "Simulated" | "Received";
    tokens: string | null;
    shares: string | null;
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
  intentId: null,
  ticker: null,
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
export function receiptVM(snapshot: Latest<StoredReceipt>): ReceiptVM {
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
  const qConversion = d.hint.quote
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
    status,
    kind: d.kind,
    intentId: d.hint.intentId,
    ticker: r?.intent.ticker ?? null,
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
            : status === "UNRECONCILED"
              ? (result?.notes.at(-1) ?? d.pendingReason ?? "Evidence incomplete")
              : null,
    signedMinimumShares: r ? formatUnits(r.intent.minShares, 18) : null,
    diffVsQuoteBps: result?.diffVsQuoteBps ?? null,
    diffVsSimBps: result?.diffVsSimBps ?? null,
    comparisonTrust: d.baselineTrust,
    provenance: `${snapshot.source}; last verified ${new Date(d.verifiedAt).toISOString()}; ${d.baselineTrust === "client-hint" ? "quote is client-reported" : "recorded comparison"}`,
    ladder:
      d.kind === "approval"
        ? []
        : [
            {
              stage: "Quoted",
              tokens: quote ? formatUnits(quote.expectedOut.raw, quote.expectedOut.decimals) : null,
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
export function hintVM(snapshot: Latest<StoredHint>): ReceiptVM {
  return {
    ...empty(snapshot.key, "pending", snapshot.data.reason),
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
    if (snapshot) return receiptVM(snapshot);
    const hint = store.latest<StoredHint>(HINT_KIND, key, { maxAgeMs: RECEIPT_MAX_AGE_MS, now });
    return hint && hint.data.expiresAt > now && hint.data.state !== "rejected"
      ? hintVM(hint)
      : empty(key);
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
    const items = new Map(receipts.map((s) => [s.key, receiptVM(s)]));
    for (const h of hints)
      if (!items.has(h.key) && h.data.expiresAt > now && h.data.state !== "rejected")
        items.set(h.key, hintVM(h));
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
