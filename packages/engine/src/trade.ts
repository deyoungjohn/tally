import {
  BSC_CHAIN_ID,
  LIQUIDMESH_ROUTER,
  MIN_ORDER_USDT,
  USDT_BSC,
  USDT_DECIMALS,
} from "@tally/config";
import {
  BelowMinimumError,
  expectedSwapGas,
  feeUsd,
  gasLimitFromEstimate,
  routeText,
  type Address,
  type ConsolidatedQuote,
  type QuoteInput,
  type QuoteRow,
} from "@tally/core";
import { pickBest, toRawQuote, type BinanceApi } from "@tally/binance";
import {
  decodeGuardRevert,
  decodeGuarded,
  encodeApprove,
  encodeSwapCall,
  feedUpdateTypedData,
  type FeedUpdate,
  type GuardReading,
  type GuardedFill,
  type SimulationResult,
  type TxRequest,
} from "@tally/chain";
import type { Hex, TransactionReceipt } from "viem";

/** Why a buy cannot go ahead, in terms the UI maps to plain words (blueprint §7.6 error table). */
export type TradeErrorKind =
  | "below_minimum"
  | "invalid_request"
  | "not_buyable"
  | "token_paused"
  | "guard_paused"
  | "rfq_required"
  | "router_not_allowed"
  | "feed_stale"
  | "feed_blocked"
  | "price_moved"
  | "route_failed"
  | "gas_estimate_failed"
  | "simulation_reverted"
  | "expired";

export class TradeError extends Error {
  constructor(
    readonly kind: TradeErrorKind,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Reads and calls the trade plan needs from BSC. The live implementation is viem with failover; tests and fixture mode fake it. */
export interface TradeChain {
  readGuard(stock: Address, router: Address): Promise<GuardReading>;
  allowance(owner: Address): Promise<bigint>;
  balances(owner: Address): Promise<{ usdt: bigint; bnb: bigint }>;
  estimateGas(
    tx: TxRequest,
  ): Promise<{ ok: true; gas: bigint } | Extract<SimulationResult, { ok: false }>>;
  simulate(tx: TxRequest, limit: bigint): Promise<SimulationResult>;
  gasPriceWei(): Promise<bigint>;
  blockNumber(): Promise<bigint>;
  /** `balanceOf(owner)` for each token, in token units (18 decimals), in the same order. */
  erc20Balances(owner: Address, tokens: Address[]): Promise<bigint[]>;
  receipt(txHash: Hex): Promise<TransactionReceipt | null>;
}

/** The Ondo feed signer. The private key lives only in the server env (`FEED_SIGNER_PK`) and is never exposed. */
export interface FeedSigner {
  address: Address;
  signUpdate(guard: Address, update: FeedUpdate): Promise<Hex>;
}

export interface TradeDeps {
  guard: Address;
  api: Pick<BinanceApi, "quoteRoutes" | "swap" | "simulate">;
  chain: TradeChain;
  quote: (input: QuoteInput) => Promise<ConsolidatedQuote>;
  bnbUsd: () => Promise<number>;
  reference: (ticker: string) => Promise<{ price: number } | null>;
  signer?: FeedSigner;
  now?: () => number;
  onWarn?: (m: string) => void;
}

export interface TradeRequest {
  ticker: string;
  issuer: "ondo" | "bstock";
  usd: number;
  /** Percent below the quoted shares the user accepts (0.1 to 5, default 1). */
  tolerancePct?: number;
  user: Address;
}

export const QUOTE_FRESH_MS = 15_000;
/** Rough gas for an ERC-20 approve on USDT (F6: 46,194 used / 60,548 limit). */
const APPROVE_GAS = 60_000n;
const DEADLINE_SECONDS = 300;
/** A signed feed update is valid from 30 s ago to 15 min ahead, the same as the owner's guarded_buy tool. */
const FEED_BACK_S = 30;
const FEED_AHEAD_S = 900;
const DISAGREE_PPM = 1_000n;
/** Within 1 ppm the guard's stored Ondo value is the same number (the API's decimals are floats), so no signed update is needed. */
const SAME_PPM = 1n;

export type TradeStatus = "needs_funds" | "needs_approval" | "ready";

export interface TradePlan {
  status: TradeStatus;
  builtAt: number;
  /** After this the quote is stale (V11): ask again before signing. */
  expiresAt: number;
  ticker: string;
  issuer: "ondo" | "bstock";
  symbol: string;
  stock: Address;
  guard: Address;
  tolerancePct: number;
  /** All amounts are decimal strings of 1e18 fixed-point integers (JSON-safe). */
  amountInUsdt: string;
  tokensOut: string;
  quotedShares: string;
  minShares: string;
  multiplier: string;
  usdPerShare: number;
  referencePrice: number | null;
  premium: number | null;
  routeText: string;
  hops: number;
  vendor: string;
  /** True when this buy carries a signed Ondo multiplier update. */
  feedUpdate: boolean;
  balances: { usdt: string; bnb: string };
  /** Present when `needs_funds`: how much is missing. */
  shortfall?: { usdt: string; bnb: string; bnbNeeded: string };
  approve?: { to: Address; data: Hex; amount: string };
  tx?: {
    to: Address;
    data: Hex;
    value: "0x0";
    gasEstimate: string;
    gasLimit: string;
    gasPriceWei: string;
    feeUsd: number | null;
    deadline: number;
    chainId: number;
  };
  simulation?: { ethCall: "ok"; binance: "ok" | "skipped"; binanceNote?: string };
  warnings: string[];
}

const E18 = 10n ** 18n;
const usdtOf = (usd: number) => BigInt(Math.round(usd * 1e6)) * 10n ** BigInt(USDT_DECIMALS - 6);

/** Plain-English messages for the guard's revert reasons (blueprint §7.6). */
export function explainRevert(reason: string, data?: Hex): TradeError {
  const r = decodeGuardRevert(data);
  switch (r?.name) {
    case "InsufficientShares":
      return new TradeError(
        "price_moved",
        "The price moved more than your tolerance. Review the new quote.",
        r.name,
      );
    case "TokenPaused":
    case "PauseCheckFailed":
      return new TradeError("token_paused", "Trading is paused for a corporate action.", r.name);
    case "EnforcedPause":
      return new TradeError(
        "guard_paused",
        "Buying is paused right now. Nothing was spent.",
        r.name,
      );
    case "FeedStale":
    case "FeedNotSeeded":
      return new TradeError(
        "feed_stale",
        "This issuer's share data is being refreshed. Try again in a minute.",
        r.name,
      );
    case "UpdateOutOfBounds":
    case "UpdateOlderThanStored":
    case "UpdateConflictsWithStored":
    case "UpdateNotValidNow":
    case "InvalidSigner":
      return new TradeError(
        "feed_blocked",
        "This token's share count changed in a way we can't verify yet, so buying is blocked.",
        r.name,
      );
    case "Expired":
      return new TradeError("expired", "The quote expired. Review the new quote.", r.name);
    case "RouterNotAllowed":
    case "InvalidRouterConfig":
      return new TradeError("router_not_allowed", "That route isn't allowed. Try again.", r.name);
    case "RouterCallFailed":
    case "NoOutput":
      return new TradeError("route_failed", "The trade route failed. Nothing was spent.", r.name);
    default:
      return new TradeError(
        "simulation_reverted",
        "The trade would fail, so nothing was sent.",
        reason,
      );
  }
}

function pickRow(cq: ConsolidatedQuote, issuer: "ondo" | "bstock"): QuoteRow | undefined {
  return cq.rows.find((r) => r.issuer === issuer);
}

/**
 * Trade plan (blueprint §7.6), as a function of the user's current state:
 * - funds short   -> `needs_funds` (the top-up flow);
 * - no allowance  -> `needs_approval` with an EXACT-amount approval (never unlimited); call again once it is mined;
 * - otherwise     -> `ready`: a fresh quote and swap built for the guard, minShares, gas = estimate × 1.25,
 *   simulated at exactly that limit (eth_call and Binance's own simulation) before any signature is requested.
 * Every call re-quotes, so the web re-calls it when `expiresAt` (15 s) passes. The API's gas (450000) is never used (V10).
 */
export async function prepareTrade(deps: TradeDeps, req: TradeRequest): Promise<TradePlan> {
  const now = deps.now ?? Date.now;
  const warnings: string[] = [];
  const tolerancePct = req.tolerancePct ?? 1;
  if (!(tolerancePct >= 0.1 && tolerancePct <= 5))
    throw new TradeError("invalid_request", "Tolerance must be between 0.1% and 5%.");
  if (!Number.isFinite(req.usd) || req.usd < MIN_ORDER_USDT) throw new BelowMinimumError(req.usd);
  const ticker = req.ticker.toUpperCase();
  const amountIn = usdtOf(req.usd);

  // 1. What the consolidated engine says about this token (executability, integrity, the resolved multiplier).
  const cq = await deps.quote({ ticker, amount: { usd: req.usd } });
  const row = pickRow(cq, req.issuer);
  if (!row)
    throw new TradeError("not_buyable", `${ticker} isn't available from this issuer on BNB Chain.`);
  if (!row.executable || !row.multiplier)
    throw new TradeError(
      "not_buyable",
      row.notExecutableReason ?? "This token can't be bought right now.",
    );
  const stock = row.address;

  // 2. A fresh quote and swap for THIS token, built for the guard's address (V12), never the user's.
  const routes = await deps.api.quoteRoutes({
    toToken: stock,
    amount: amountIn,
    wallet: deps.guard,
  });
  const best = pickBest(routes);
  if (!best) throw new TradeError("route_failed", "No route was returned for this buy.");
  const raw = toRawQuote(best);
  if (raw.executionMode !== "SWAP")
    throw new TradeError(
      "rfq_required",
      "This issuer needs a signed order. Try the other issuer.",
      raw.executionMode,
    );
  const sw = await deps.api.swap({
    toToken: stock,
    amount: amountIn,
    wallet: deps.guard,
    quoteId: raw.quoteId,
    slippagePercent: String(tolerancePct),
  });
  if (sw.executionMode !== "SWAP" || !sw.tx?.to || !sw.tx.data)
    throw new TradeError(
      "rfq_required",
      "This issuer needs a signed order. Try the other issuer.",
      sw.executionMode,
    );
  const router = sw.tx.to.toLowerCase() as Address;
  const routerData = sw.tx.data as Hex;

  // 3. The guard's own view: paused, enabled, router allow-listed, which multiplier it will use.
  const g = await deps.chain.readGuard(stock, router);
  if (g.paused)
    throw new TradeError("guard_paused", "Buying is paused right now. Nothing was spent.");
  if (!g.enabled)
    throw new TradeError("not_buyable", `${row.symbol} isn't enabled in ShareGuard yet.`);
  if (g.tokenPaused === true)
    throw new TradeError("token_paused", "Trading is paused for a corporate action.");
  if (!g.routerAllowed)
    throw new TradeError("router_not_allowed", "The trade route isn't on ShareGuard's allow list.");
  if (g.approveTarget.toLowerCase() !== raw.approveTarget.toLowerCase())
    throw new TradeError(
      "router_not_allowed",
      "The route's approval target doesn't match ShareGuard's configuration.",
    );

  // 4. Which multiplier the contract will use, and whether an Ondo buy has to carry a signed update.
  const engineM = row.multiplier.value;
  const stored = g.sharesPerToken;
  let m: bigint;
  let feed: { update: FeedUpdate; signature: Hex } | undefined;
  if (g.source === 2) {
    if (stored !== undefined && ppm(stored, engineM) <= SAME_PPM) {
      m = stored;
    } else if (deps.signer) {
      const nowS = BigInt(Math.floor(now() / 1000));
      const update: FeedUpdate = {
        stock,
        multiplier: engineM,
        validAfter: nowS - BigInt(FEED_BACK_S),
        validUntil: nowS + BigInt(FEED_AHEAD_S),
      };
      feed = { update, signature: await deps.signer.signUpdate(deps.guard, update) };
      m = engineM;
    } else if (stored !== undefined && ppm(stored, engineM) <= DISAGREE_PPM) {
      m = stored;
    } else {
      throw new TradeError(
        "feed_stale",
        "This issuer's share data is being refreshed. Try again in a minute.",
        g.sharesPerTokenError,
      );
    }
  } else {
    if (stored === undefined)
      throw new TradeError(
        "not_buyable",
        "The share count for this token can't be read right now.",
        g.sharesPerTokenError,
      );
    m = stored;
    if (ppm(stored, engineM) > DISAGREE_PPM)
      warnings.push(
        "The on-chain share count and the data feed differ by more than 0.1%; ShareGuard uses the on-chain value.",
      );
  }

  // 5. Shares and the guaranteed minimum.
  const quotedShares = (raw.tokensOut * m) / E18;
  const minShares = (quotedShares * BigInt(10_000 - Math.round(tolerancePct * 100))) / 10_000n;
  if (minShares <= 0n) throw new TradeError("route_failed", "The quote returned no shares.");
  const ref = await deps.reference(ticker).catch(() => null);
  const usdPerShare = Number(amountIn) / Number(quotedShares); // USDT ≈ $1; the UI says "USDT per share"
  const premium = ref ? usdPerShare / ref.price - 1 : null;

  // 6. Funds, allowance, gas price.
  const [bal, allowance, gasPriceWei] = await Promise.all([
    deps.chain.balances(req.user),
    deps.chain.allowance(req.user),
    deps.chain.gasPriceWei(),
  ]);
  const bnbNeeded =
    (APPROVE_GAS + gasLimitFromEstimate(BigInt(expectedSwapGas(raw.legCount)))) * gasPriceWei;
  const base = {
    builtAt: now(),
    expiresAt: now() + QUOTE_FRESH_MS,
    ticker,
    issuer: req.issuer,
    symbol: row.symbol,
    stock,
    guard: deps.guard,
    tolerancePct,
    amountInUsdt: amountIn.toString(),
    tokensOut: raw.tokensOut.toString(),
    quotedShares: quotedShares.toString(),
    minShares: minShares.toString(),
    multiplier: m.toString(),
    usdPerShare,
    referencePrice: ref?.price ?? null,
    premium,
    routeText: routeText(raw),
    hops: raw.legCount,
    vendor: raw.vendor,
    feedUpdate: feed !== undefined,
    balances: { usdt: bal.usdt.toString(), bnb: bal.bnb.toString() },
    warnings,
  };
  if (bal.usdt < amountIn || bal.bnb < bnbNeeded) {
    return {
      ...base,
      status: "needs_funds",
      shortfall: {
        usdt: (bal.usdt < amountIn ? amountIn - bal.usdt : 0n).toString(),
        bnb: (bal.bnb < bnbNeeded ? bnbNeeded - bal.bnb : 0n).toString(),
        bnbNeeded: bnbNeeded.toString(),
      },
    };
  }
  if (allowance < amountIn) {
    return {
      ...base,
      status: "needs_approval",
      approve: {
        to: USDT_BSC,
        data: encodeApprove(deps.guard, amountIn),
        amount: amountIn.toString(),
      },
    };
  }

  // 7. Gas: estimate from the user's own address, limit = estimate × 1.25, simulated at exactly that limit (V10).
  const deadline = BigInt(Math.floor(now() / 1000) + DEADLINE_SECONDS);
  const data = encodeSwapCall({
    amountIn,
    stock,
    minShares,
    router,
    routerData,
    recipient: req.user,
    deadline,
    feed,
  });
  const tx: TxRequest = { account: req.user, to: deps.guard, data };
  const est = await deps.chain.estimateGas(tx);
  if (!est.ok) throw explainRevert(est.reason, est.revertData);
  const limit = gasLimitFromEstimate(est.gas);
  const sim = await deps.chain.simulate(tx, limit);
  if (!sim.ok) throw explainRevert(sim.reason, sim.revertData);
  let binance: "ok" | "skipped" = "ok";
  let binanceNote: string | undefined;
  try {
    const b = await deps.api.simulate({ from: req.user, to: deps.guard, data });
    if (b.status !== "SUCCESS")
      throw new TradeError(
        "simulation_reverted",
        "The trade would fail, so nothing was sent.",
        b.failReason ?? b.status,
      );
  } catch (e) {
    if (e instanceof TradeError) throw e;
    // The Binance simulation is a second opinion, not a gate: our own eth_call at the exact limit already passed.
    binance = "skipped";
    binanceNote = e instanceof Error ? e.message : String(e);
    warnings.push(
      `Binance simulation unavailable (${binanceNote}); the on-chain simulation passed.`,
    );
    deps.onWarn?.(`trade: Binance simulate failed: ${binanceNote}`);
  }
  const bnb = await deps.bnbUsd().catch(() => null);
  return {
    ...base,
    status: "ready",
    tx: {
      to: deps.guard,
      data,
      value: "0x0",
      gasEstimate: est.gas.toString(),
      gasLimit: limit.toString(),
      gasPriceWei: gasPriceWei.toString(),
      feeUsd: bnb === null ? null : feeUsd(Number(est.gas), gasPriceWei, bnb),
      deadline: Number(deadline),
      chainId: BSC_CHAIN_ID,
    },
    simulation: { ethCall: "ok", binance, binanceNote },
  };
}

function ppm(a: bigint, b: bigint): bigint {
  const d = a > b ? a - b : b - a;
  return b === 0n ? 10n ** 9n : (d * 1_000_000n) / b;
}

export interface TradeReceipt {
  status: "pending" | "success" | "reverted";
  txHash: Hex;
  blockNumber?: number;
  gasUsed?: number;
  gasUsd?: number | null;
  fill?: {
    tokensOut: string;
    shares: string;
    multiplier: string;
    amountInUsdt: string;
    usdPerShare: number;
    referencePrice: number | null;
    premium: number | null;
    stock: Address;
    user: Address;
  };
  bscscan: string;
  warning?: string;
}

/** Receipt in shares: poll with failover, decode the guard's `Guarded` event (blueprint §7.6 step 8). */
export async function getTradeReceipt(
  deps: Pick<TradeDeps, "guard" | "chain" | "bnbUsd" | "reference">,
  txHash: Hex,
  ticker?: string,
): Promise<TradeReceipt> {
  const bscscan = `https://bscscan.com/tx/${txHash}`;
  const r = await deps.chain.receipt(txHash);
  if (!r) return { status: "pending", txHash, bscscan };
  const gasUsed = Number(r.gasUsed);
  const price = r.effectiveGasPrice ?? 0n;
  const bnb = await deps.bnbUsd().catch(() => null);
  const gasUsd = bnb === null ? null : feeUsd(gasUsed, price, bnb);
  const common = { txHash, blockNumber: Number(r.blockNumber), gasUsed, gasUsd, bscscan };
  if (r.status !== "success") return { ...common, status: "reverted" };
  const ev: GuardedFill | undefined = decodeGuarded(r, deps.guard);
  if (!ev)
    return {
      ...common,
      status: "success",
      warning: "The transaction succeeded but no ShareGuard receipt was found in it.",
    };
  const ref = ticker ? await deps.reference(ticker.toUpperCase()).catch(() => null) : null;
  const usdPerShare = ev.shares > 0n ? Number(ev.amountIn) / Number(ev.shares) : 0;
  return {
    ...common,
    status: "success",
    fill: {
      tokensOut: ev.tokensOut.toString(),
      shares: ev.shares.toString(),
      multiplier: ev.multiplier.toString(),
      amountInUsdt: ev.amountIn.toString(),
      usdPerShare,
      referencePrice: ref?.price ?? null,
      premium: ref ? usdPerShare / ref.price - 1 : null,
      stock: ev.stock,
      user: ev.user,
    },
  };
}

export { LIQUIDMESH_ROUTER, feedUpdateTypedData };
