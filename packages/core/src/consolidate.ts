import { MIN_ORDER_USDT, QUOTE_PLACEHOLDER_WALLET, USDT_DECIMALS } from "@tally/config";
import { expectedSwapGas, feeUsd } from "./gas";
import { gradeIntegrity, type Integrity } from "./integrity";
import {
  checkOndoMultiplier,
  isUnitTrap,
  resolveMultiplier,
  sharesFromTokens,
  corporateActionKind,
  type OndoBoundsResult,
  type ResolvedMultiplier,
} from "./multiplier";
import { formatUnits, mulDivUp, parseDecimal, toNumber } from "./units";
import {
  isKindedError,
  type Address,
  type CorporateActionKind,
  type EngineErrorKind,
  type MultiplierReadings,
  type PriceCheckInputs,
  type RawQuote,
  type ReferencePrice,
  type RegistryToken,
  type Session,
  type TokenMarketFacts,
} from "./types";

/** I/O is injected, so this package stays pure. @tally/binance and @tally/chain implement the ports. */
export interface EnginePorts {
  registry: { tokensFor(ticker: string): Promise<RegistryToken[]> };
  facts: {
    multipliers(token: RegistryToken): Promise<MultiplierReadings>;
    market(token: RegistryToken): Promise<TokenMarketFacts>;
    reference(ticker: string): Promise<ReferencePrice | null>;
    /** Optional: persist an Ondo multiplier reading that passed the bounds check as the new baseline. */
    recordAccepted?(token: RegistryToken, value: bigint, at: number): Promise<void>;
    /** Optional: remember that this token's status showed a corporate action (kept across runs, for the bounds check). */
    noteCorporateAction?(
      token: RegistryToken,
      kind: CorporateActionKind,
      at: number,
    ): Promise<void>;
    /** Optional: token price and US share price for the independent price check. Called only when a multiplier changed. */
    priceCheck?(token: RegistryToken): Promise<PriceCheckInputs>;
  };
  quotes: { quote(token: RegistryToken, amountInUsdt: bigint, wallet: Address): Promise<RawQuote> };
  chain: { gasPriceWei(): Promise<bigint>; bnbUsd(): Promise<number> };
  now?: () => number;
}

export type AmountInput = { usd: number } | { shares: number };

export interface QuoteInput {
  ticker: string;
  amount: AmountInput;
  /** Defaults to the ShareGuard placeholder: quotes don't depend on wallet history (F3). */
  wallet?: Address;
}

export interface RowError {
  kind: EngineErrorKind | "invalid";
  message: string;
}

export interface QuoteRow {
  symbol: string;
  issuer: RegistryToken["issuer"];
  address: Address;
  decimals: number;
  /** Can Tally route a buy to this token right now? */
  executable: boolean;
  /** Plain-English reason when not executable. */
  notExecutableReason?: string;
  multiplier?: ResolvedMultiplier;
  amountInUsdt?: bigint;
  tokensOut?: bigint;
  /** Shares received, in the token's decimals. */
  sharesOut?: bigint;
  usdPerShare?: number;
  /** Premium vs the US price, as a fraction. */
  premium?: number;
  hops?: number;
  routeText?: string;
  vendor?: string;
  executionMode?: string;
  priceImpactPct?: number;
  quoteId?: string;
  /** Approximate network fee in USD (gas model × gas price × BNB price). */
  feeUsd?: number;
  expectedGas?: number;
  /** (USD spent + fee) / shares: what ranking uses. */
  effectiveCostPerShare?: number;
  rank?: number;
  isBest: boolean;
  integrity: Integrity;
  error?: RowError;
}

export interface Saving {
  /** Extra USD the runner-up costs for the same number of shares. */
  usd: number;
  /** 1 − best/runner-up effective cost. */
  pct: number;
  vsSymbol: string;
}

export interface ConsolidatedQuote {
  ticker: string;
  asOf: string;
  amount: AmountInput;
  referencePrice: number | null;
  session: Session;
  rows: QuoteRow[];
  best?: string;
  saving?: Saving;
  warnings: string[];
}

export class UnknownTickerError extends Error {
  readonly kind = "param" as const;
  constructor(ticker: string) {
    super(`Unknown ticker ${ticker} on BNB Chain`);
  }
}
export class BelowMinimumError extends Error {
  readonly kind = "below_minimum" as const;
  constructor(readonly usd: number) {
    super(`Minimum order is $${MIN_ORDER_USDT} (got $${usd})`);
  }
}
export class NoReferencePriceError extends Error {
  readonly kind = "unknown" as const;
  constructor(ticker: string) {
    super(`No US reference price for ${ticker}, so a share amount can't be converted to dollars`);
  }
}

const FATAL: ReadonlySet<EngineErrorKind> = new Set(["region_block", "auth"]);
const MIN_ORDER = parseDecimal(String(MIN_ORDER_USDT), USDT_DECIMALS);

function usdToUsdt(usd: number): bigint {
  return BigInt(Math.round(usd * 1e6)) * 10n ** BigInt(USDT_DECIMALS - 6);
}

/** "USDT → BTCB → USDC → NVDAB" from the legs the API returned (parallel splits show once). */
export function routeText(q: RawQuote): string {
  return ["USDT", ...q.hops.map((h) => h.toSymbol)].join(" → ");
}

interface Prepared {
  token: RegistryToken;
  readings: MultiplierReadings;
  facts: TokenMarketFacts;
  multiplier: ResolvedMultiplier | null;
  /** Ondo multiplier bounds result; undefined for issuers read on-chain. */
  bounds?: OndoBoundsResult;
  blockedReason?: string;
}

/**
 * Consolidated quote (blueprint §7.4): resolve tokens, read multiplier/status/integrity inputs, quote every executable
 * token separately (the API offers no cross-issuer comparison, V7), compute shares and $/share, rank by effective cost.
 */
export async function consolidatedQuote(
  ports: EnginePorts,
  input: QuoteInput,
): Promise<ConsolidatedQuote> {
  const now = ports.now ?? Date.now;
  const ticker = input.ticker.toUpperCase();
  const wallet = input.wallet ?? QUOTE_PLACEHOLDER_WALLET;
  const warnings: string[] = [];

  const tokens = await ports.registry.tokensFor(ticker);
  if (tokens.length === 0) throw new UnknownTickerError(ticker);

  const [prepared, ref] = await Promise.all([
    Promise.all(tokens.map((t) => prepare(ports, t, now()))),
    ports.facts.reference(ticker).catch((e) => rethrowFatal(e, () => null)),
  ]);
  if (!ref) warnings.push("No US reference price available: premiums can't be computed.");

  // Amount to USDT (§7.4 step 4). USD mode is exact; shares mode estimates per token and re-quotes once.
  let usdAmountIn: bigint | undefined;
  if ("usd" in input.amount) {
    usdAmountIn = usdToUsdt(input.amount.usd);
    if (usdAmountIn < MIN_ORDER) throw new BelowMinimumError(input.amount.usd);
  } else if (!ref) {
    throw new NoReferencePriceError(ticker);
  }

  const [gasPriceWei, bnbUsd] = await Promise.all([
    ports.chain.gasPriceWei().catch((e) => rethrowFatal(e, () => undefined)),
    ports.chain.bnbUsd().catch((e) => rethrowFatal(e, () => undefined)),
  ]);
  if (gasPriceWei === undefined || bnbUsd === undefined)
    warnings.push("Gas price or BNB price unavailable: network fee not shown, ranking ignores it.");

  const resolved = prepared
    .map((p) => p.multiplier?.value)
    .filter((v): v is bigint => v !== undefined);

  const rows = await Promise.all(
    prepared.map(async (p): Promise<QuoteRow> => {
      const others = prepared
        .filter((o) => o !== p && o.multiplier)
        .map((o) => o.multiplier!.value);
      const unitTrap = p.multiplier ? isUnitTrap(p.multiplier.value, others) : false;
      const base = {
        symbol: p.token.symbol,
        issuer: p.token.issuer,
        address: p.token.address,
        decimals: p.token.decimals,
        isBest: false,
      };

      if (p.blockedReason || !p.multiplier) {
        const integrity = gradeFor(p, ref, undefined, unitTrap, now());
        return {
          ...base,
          executable: false,
          notExecutableReason: p.blockedReason ?? "No share multiplier available",
          multiplier: p.multiplier ?? undefined,
          integrity,
        };
      }

      let q: RawQuote;
      try {
        q = await quoteToken(ports, p, wallet, input.amount, usdAmountIn, ref);
      } catch (e) {
        if (isKindedError(e) && FATAL.has(e.kind)) throw e;
        const integrity = gradeFor(p, ref, undefined, unitTrap, now());
        return {
          ...base,
          executable: false,
          notExecutableReason: "Quote unavailable",
          multiplier: p.multiplier,
          integrity,
          error: {
            kind: isKindedError(e) ? e.kind : "unknown",
            message: e instanceof Error ? e.message : String(e),
          },
        };
      }

      const sharesOut = sharesFromTokens(q.tokensOut, p.multiplier.value);
      const sharesN = toNumber(sharesOut, p.token.decimals);
      const usdIn = toNumber(q.amountIn, USDT_DECIMALS) * q.usdtPrice;
      const usdPerShare = sharesN > 0 ? usdIn / sharesN : undefined;
      const premium = usdPerShare !== undefined && ref ? usdPerShare / ref.price - 1 : undefined;
      const gas = expectedSwapGas(q.legCount);
      const fee =
        gasPriceWei !== undefined && bnbUsd !== undefined
          ? feeUsd(gas, gasPriceWei, bnbUsd)
          : undefined;
      const effective = sharesN > 0 ? (usdIn + (fee ?? 0)) / sharesN : undefined;
      const swap = q.executionMode === "SWAP";
      const integrity = gradeFor(p, ref, premium, unitTrap, now());
      return {
        ...base,
        executable: swap,
        notExecutableReason: swap
          ? undefined
          : "This issuer needs a signed order. Try the other issuer.",
        multiplier: p.multiplier,
        amountInUsdt: q.amountIn,
        tokensOut: q.tokensOut,
        sharesOut,
        usdPerShare,
        premium,
        hops: q.legCount,
        routeText: routeText(q),
        vendor: q.vendor,
        executionMode: q.executionMode,
        priceImpactPct: q.priceImpactPct,
        quoteId: q.quoteId,
        feeUsd: fee,
        expectedGas: gas,
        effectiveCostPerShare: effective,
        integrity,
      };
    }),
  );

  // A fact that is missing because a call failed (not because it does not apply) must be visible in the result itself:
  // the 2026-10-02 live run showed a clean score where a probe 18 minutes earlier showed a deduction.
  for (const p of prepared) {
    for (const [key, why] of Object.entries(p.facts.notes ?? {})) {
      if (why && !why.startsWith("not fetched"))
        warnings.push(`${p.token.symbol}: ${key} check skipped: ${why}`);
    }
  }
  if (resolved.length === 0) warnings.push("No share multiplier could be resolved for any token.");
  // Rows we never tried to quote (xStocks, paused) carry no error, so test for "something failed and nothing succeeded".
  if (rows.some((r) => r.error) && !rows.some((r) => r.sharesOut !== undefined)) {
    throw new Error(
      `Every quote failed: ${rows
        .filter((r) => r.error)
        .map((r) => `${r.symbol}: ${r.error!.message}`)
        .join("; ")}`,
    );
  }

  const { best, saving } = rank(rows);
  return {
    ticker,
    asOf: new Date(now()).toISOString(),
    amount: input.amount,
    referencePrice: ref?.price ?? null,
    session:
      ref?.session ??
      prepared.map((p) => p.facts.status?.session).find((s) => s && s !== "unknown") ??
      "unknown",
    rows,
    best,
    saving,
    warnings,
  };
}

async function prepare(ports: EnginePorts, token: RegistryToken, now: number): Promise<Prepared> {
  const [readings, facts] = await Promise.all([
    ports.facts.multipliers(token).catch((e) => rethrowFatal(e, () => ({}) as MultiplierReadings)),
    ports.facts
      .market(token)
      .catch((e) => rethrowFatal(e, () => ({ status: null }) as TokenMarketFacts)),
  ]);
  const multiplier = resolveMultiplier(token.issuer, readings);
  const p: Prepared = { token, readings, facts, multiplier };
  if (multiplier && token.issuer === "ondo") {
    // A status showing a corporate action is remembered (the change may land hours later, after the halt), and counted
    // as seen right now.
    const kind = corporateActionKind(facts.status?.reasonMsg);
    let action = facts.corporateAction;
    if (kind) {
      const continuing =
        action && action.kind === kind && now - action.lastSeenAt <= 7 * 24 * 3_600_000;
      action = { kind, firstSeenAt: continuing ? action!.firstSeenAt : now, lastSeenAt: now };
      await ports.facts
        .noteCorporateAction?.(token, kind, now)
        .catch((e) => rethrowFatal(e, () => undefined));
    }
    // The price check only runs for a changed multiplier, so the extra data call is rare.
    const previous = facts.multiplierBaseline;
    let prices: PriceCheckInputs | undefined;
    if (previous && previous.value !== multiplier.value && ports.facts.priceCheck) {
      prices = await ports.facts
        .priceCheck(token)
        .catch((e) =>
          rethrowFatal(e, () => ({ note: e instanceof Error ? e.message : String(e) })),
        );
      if (prices?.note) (facts.notes ??= {}).priceCheck = prices.note;
    }
    p.bounds = checkOndoMultiplier({
      current: multiplier.value,
      previous,
      now,
      status: facts.status,
      action,
      changedAt: facts.multiplierChangedAt,
      prices,
    });
    // Only readings that pass become the new baseline. With no baseline yet, a first sighting is recorded only when the
    // sources agree with each other, so one bad first reading cannot poison the store.
    const accept =
      p.bounds.outcome === "pass" || (p.bounds.outcome === "skipped" && !multiplier.disagree);
    if (accept && ports.facts.recordAccepted) {
      await ports.facts
        .recordAccepted(token, multiplier.value, now)
        .catch((e) => rethrowFatal(e, () => undefined));
    }
  }
  if (!token.executable)
    p.blockedReason = "Not tradable through Tally: this issuer has almost no BNB Chain liquidity.";
  else if (facts.status?.kind === "paused")
    p.blockedReason = facts.status.reasonMsg
      ? `Paused: ${facts.status.reasonMsg}`
      : "Trading is paused";
  else if (facts.status?.kind === "unsupported")
    p.blockedReason = "Binance doesn't support trading this token right now";
  else if (facts.onchainVolume24hUsd !== undefined && facts.onchainVolume24hUsd < 1_000)
    p.blockedReason = "Ghost market: almost no trading on BNB Chain";
  else if (p.bounds?.outcome === "fail")
    p.blockedReason = `Share multiplier failed its sanity check (${p.bounds.detail})`;
  return p;
}

function gradeFor(
  p: Prepared,
  ref: ReferencePrice | null,
  quotedPremium: number | undefined,
  unitTrap: boolean,
  now: number,
): Integrity {
  // A token we didn't quote (xStocks, paused) is judged on its listed price, which is exactly what exposes stale ghost listings.
  let premium = quotedPremium;
  let basis: "quote" | "listed price" | undefined =
    quotedPremium === undefined ? undefined : "quote";
  if (premium === undefined && ref && p.facts.listedTokenPrice !== undefined && p.multiplier) {
    premium = p.facts.listedTokenPrice / toNumber(p.multiplier.value, 18) / ref.price - 1;
    basis = "listed price";
  }
  return gradeIntegrity({
    multiplier: p.multiplier,
    readings: p.readings,
    bounds: p.bounds,
    validation: p.bounds?.validation,
    premium,
    premiumBasis: basis,
    session: ref?.session ?? p.facts.status?.session ?? "unknown",
    onchainVolume24hUsd: p.facts.onchainVolume24hUsd,
    status: p.facts.status,
    attestation: p.facts.attestation,
    now,
    unitTrap,
    notes: p.facts.notes,
  });
}

/** What the engine knows about one token before any quote: readings, resolved multiplier, facts, bounds and the full check log. */
export interface TokenInspection {
  symbol: string;
  issuer: RegistryToken["issuer"];
  address: Address;
  executable: boolean;
  blockedReason?: string;
  readings: MultiplierReadings;
  multiplier: ResolvedMultiplier | null;
  facts: TokenMarketFacts;
  bounds?: OndoBoundsResult;
  referencePrice: ReferencePrice | null;
  integrity: Integrity;
}

/** The `tally facts` view: everything the grade is built from, with the check log, and no quote. */
export async function inspectTicker(
  ports: EnginePorts,
  ticker: string,
): Promise<TokenInspection[]> {
  const now = (ports.now ?? Date.now)();
  const symbol = ticker.toUpperCase();
  const tokens = await ports.registry.tokensFor(symbol);
  if (tokens.length === 0) throw new UnknownTickerError(symbol);
  const [prepared, ref] = await Promise.all([
    Promise.all(tokens.map((t) => prepare(ports, t, now))),
    ports.facts.reference(symbol).catch((e) => rethrowFatal(e, () => null)),
  ]);
  return prepared.map((p) => {
    const others = prepared.filter((o) => o !== p && o.multiplier).map((o) => o.multiplier!.value);
    const unitTrap = p.multiplier ? isUnitTrap(p.multiplier.value, others) : false;
    return {
      symbol: p.token.symbol,
      issuer: p.token.issuer,
      address: p.token.address,
      executable: p.token.executable && !p.blockedReason,
      blockedReason: p.blockedReason,
      readings: p.readings,
      multiplier: p.multiplier,
      facts: p.facts,
      bounds: p.bounds,
      referencePrice: ref,
      integrity: gradeFor(p, ref, undefined, unitTrap, now),
    };
  });
}

async function quoteToken(
  ports: EnginePorts,
  p: Prepared,
  wallet: Address,
  amount: AmountInput,
  usdAmountIn: bigint | undefined,
  ref: ReferencePrice | null,
): Promise<RawQuote> {
  if (usdAmountIn !== undefined) return ports.quotes.quote(p.token, usdAmountIn, wallet);
  // Shares mode: estimate amountIn = shares × refPrice × 1.01, quote once, scale linearly, re-quote once (§7.4 step 4).
  const target = (amount as { shares: number }).shares;
  const estimate = max(usdToUsdt(target * ref!.price * 1.01), MIN_ORDER);
  const first = await ports.quotes.quote(p.token, estimate, wallet);
  const got = sharesFromTokens(first.tokensOut, p.multiplier!.value);
  if (got === 0n) return first;
  const targetRaw = parseDecimal(
    target.toFixed(p.token.decimals > 8 ? 8 : p.token.decimals),
    p.token.decimals,
  );
  const scaled = max(mulDivUp(first.amountIn, targetRaw * 10005n, got * 10000n), MIN_ORDER);
  return ports.quotes.quote(p.token, scaled, wallet);
}

function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function rethrowFatal<T>(e: unknown, fallback: () => T): T {
  if (isKindedError(e) && FATAL.has(e.kind)) throw e;
  return fallback();
}

/** Rank by effective cost per share; ties (within 1e-6) go to fewer hops, then the better integrity score (§7.4 step 8). */
export function rank(rows: QuoteRow[]): { best?: string; saving?: Saving } {
  const eligible = rows.filter((r) => r.executable && r.effectiveCostPerShare !== undefined);
  eligible.sort((a, b) => {
    const x = a.effectiveCostPerShare!;
    const y = b.effectiveCostPerShare!;
    if (Math.abs(x - y) / Math.min(x, y) > 1e-6) return x - y;
    return (a.hops ?? 99) - (b.hops ?? 99) || b.integrity.score - a.integrity.score;
  });
  eligible.forEach((r, i) => {
    r.rank = i + 1;
    r.isBest = i === 0;
  });
  const [best, runner] = eligible;
  if (!best) return {};
  if (!runner) return { best: best.symbol };
  const sharesN = toNumber(best.sharesOut!, best.decimals);
  return {
    best: best.symbol,
    saving: {
      usd: (runner.effectiveCostPerShare! - best.effectiveCostPerShare!) * sharesN,
      pct: 1 - best.effectiveCostPerShare! / runner.effectiveCostPerShare!,
      vsSymbol: runner.symbol,
    },
  };
}

export function formatShares(shares: bigint, decimals: number): string {
  return formatUnits(shares, decimals, 6);
}
