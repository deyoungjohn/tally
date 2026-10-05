import { BSC_CHAIN_ID, MIN_ORDER_USDT, USDT_BSC } from "@tally/config";
import {
  BelowMinimumError,
  E18,
  feeUsd,
  gasLimitFromEstimate,
  mulDiv,
  parseDecimal,
  type Address,
  type ConsolidatedQuote,
  type QuoteInput,
  type QuoteRow,
  type RawQuote,
} from "@tally/core";
import { pickBest, toRawQuote, type BinanceApi } from "@tally/binance";
import { encodeApprove, ERC20_ABI, type TxRequest } from "@tally/chain";
import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import {
  explainRevert,
  QUOTE_FRESH_MS,
  TradeError,
  type TradeChain,
  type TradeStatus,
} from "./trade";

export interface SellRequest {
  ticker: string;
  issuer: "ondo" | "bstock" | "xstocks";
  /** Amount to sell: specified in human shares, estimated usd, or raw token units. */
  shares?: number;
  usd?: number;
  tokens?: string;
  tolerancePct?: number;
  user: Address;
}

export interface SellPlan {
  status: TradeStatus;
  builtAt: number;
  expiresAt: number;
  ticker: string;
  issuer: "ondo" | "bstock";
  symbol: string;
  stock: Address;
  user: Address;
  tolerancePct: number;
  /** Amounts as decimal strings of 1e18 fixed-point integers (JSON-safe). */
  tokensIn: string;
  sharesIn: string;
  quotedUsdtOut: string;
  minUsdtOut: string;
  multiplier: string;
  usdPerShare: number;
  referencePrice: number | null;
  routeText: string;
  hops: number;
  vendor: string;
  balances: { tokens: string; bnb: string };
  shortfall?: { tokens: string; bnb: string; bnbNeeded: string };
  approve?: { to: Address; spender: Address; data: Hex; amount: string };
  tx?: {
    to: Address;
    data: Hex;
    value: "0x0";
    gasEstimate: string;
    gasLimit: string;
    gasPriceWei: string;
    feeUsd: number | null;
    chainId: number;
  };
  simulation?: { ethCall: "ok"; binance: "ok" | "skipped"; binanceNote?: string };
  warnings: string[];
}

export interface SellDeps {
  api: Pick<BinanceApi, "quoteRoutes" | "swap" | "simulate">;
  chain: TradeChain;
  quote: (input: QuoteInput) => Promise<ConsolidatedQuote>;
  bnbUsd: () => Promise<number>;
  reference: (ticker: string) => Promise<{ price: number } | null>;
  tokenAllowance?: (stock: Address, owner: Address, spender: Address) => Promise<bigint>;
  now?: () => number;
  onWarn?: (m: string) => void;
}

const APPROVE_GAS = 60_000n;
const ESTIMATED_SWAP_GAS = 450_000n;

function pickRow(
  cq: ConsolidatedQuote,
  issuer: "ondo" | "bstock" | "xstocks",
): QuoteRow | undefined {
  return cq.rows.find((r) => r.issuer === issuer);
}

function buildSellRouteText(symbol: string, raw: RawQuote): string {
  const hops = raw.hops.map((h) => h.toSymbol);
  return [symbol, ...hops].join(" → ");
}

async function readTokenAllowance(
  deps: SellDeps,
  stock: Address,
  owner: Address,
  spender: Address,
): Promise<bigint> {
  if (deps.tokenAllowance) return deps.tokenAllowance(stock, owner, spender);
  try {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    });
    const sim = await deps.chain.simulate({ account: owner, to: stock, data }, 50_000n);
    if (sim.ok && sim.returnData && sim.returnData.length >= 66) {
      return decodeFunctionResult({
        abi: ERC20_ABI,
        functionName: "allowance",
        data: sim.returnData,
      });
    }
  } catch {
    // fall through to default chain allowance
  }
  return deps.chain.allowance(owner);
}

/**
 * Sell plan: converts tokenized stock directly into USDT via Binance Web3 Aggregator swap calldata
 * signed directly by the user's wallet (EOA). The router's minReceiveAmount enforces the floor.
 */
export async function prepareSell(deps: SellDeps, req: SellRequest): Promise<SellPlan> {
  const now = deps.now ?? Date.now;
  const warnings: string[] = [];
  const tolerancePct = req.tolerancePct ?? 1;
  if (!(tolerancePct >= 0.1 && tolerancePct <= 5))
    throw new TradeError("invalid_request", "Tolerance must be between 0.1% and 5%.");

  if (req.issuer === "xstocks" || req.ticker.toUpperCase().endsWith("X")) {
    throw new TradeError("not_buyable", "No market to exit this token on BNB Chain.");
  }

  const ticker = req.ticker.toUpperCase();

  // 1. Resolve token facts and multiplier from consolidated quote
  const cq = await deps.quote({ ticker, amount: { usd: 6 } });
  const row = pickRow(cq, req.issuer);
  if (!row) {
    throw new TradeError("not_buyable", `${ticker} isn't available from this issuer on BNB Chain.`);
  }

  if (row.issuer === ("xstocks" as const) || row.integrity.flags.includes("ghost")) {
    throw new TradeError("not_buyable", "No market to exit this token on BNB Chain.");
  }

  if (!row.multiplier) {
    throw new TradeError(
      "not_buyable",
      row.notExecutableReason ?? "This token can't be traded right now.",
    );
  }

  const stock = row.address;
  const multiplier = row.multiplier.value;

  // 2. Determine token amountIn to sell
  let amountIn: bigint;
  if (req.tokens !== undefined) {
    amountIn = BigInt(req.tokens);
  } else if (req.shares !== undefined) {
    if (!Number.isFinite(req.shares) || req.shares <= 0) {
      throw new TradeError("invalid_request", "Shares to sell must be positive.");
    }
    const sharesBigInt = parseDecimal(req.shares.toFixed(8), 18);
    amountIn = mulDiv(sharesBigInt, E18, multiplier);
  } else if (req.usd !== undefined) {
    if (!Number.isFinite(req.usd) || req.usd < MIN_ORDER_USDT) {
      throw new BelowMinimumError(req.usd);
    }
    const ref = await deps.reference(ticker).catch(() => null);
    const unitPrice = ref?.price ?? 1;
    const estShares = req.usd / unitPrice;
    const sharesBigInt = parseDecimal(estShares.toFixed(8), 18);
    amountIn = mulDiv(sharesBigInt, E18, multiplier);
  } else {
    throw new TradeError("invalid_request", "Specify shares, usd, or tokens to sell.");
  }

  if (amountIn <= 0n) {
    throw new TradeError("invalid_request", "Amount to sell must be greater than zero.");
  }

  // 3. Request quote from Binance API: fromToken = stock, toToken = USDT, wallet = user
  const routes = await deps.api.quoteRoutes({
    toToken: USDT_BSC,
    fromToken: stock,
    amount: amountIn,
    wallet: req.user,
  });

  const best = pickBest(routes);
  if (!best) {
    throw new TradeError("route_failed", "No route was returned for this sell.");
  }

  const raw = toRawQuote(best);
  if (raw.executionMode !== "SWAP") {
    throw new TradeError(
      "rfq_required",
      "This issuer needs a signed order. Try the other issuer.",
      raw.executionMode,
    );
  }

  // Check 5 USD minimum enforced by Binance aggregator
  if (raw.tokensOut < 5n * 10n ** 18n) {
    throw new BelowMinimumError(Number(raw.tokensOut) / 1e18);
  }

  // 4. Build direct swap transaction calldata with user's tolerance
  const sw = await deps.api.swap({
    toToken: USDT_BSC,
    fromToken: stock,
    amount: amountIn,
    wallet: req.user,
    quoteId: raw.quoteId,
    slippagePercent: String(tolerancePct),
  });

  if (sw.executionMode !== "SWAP" || !sw.tx?.to || !sw.tx.data) {
    throw new TradeError(
      "rfq_required",
      "This issuer needs a signed order. Try the other issuer.",
      sw.executionMode,
    );
  }

  const router = sw.tx.to.toLowerCase() as Address;
  const routerData = sw.tx.data as Hex;
  const approveTarget = (
    (sw.routerResult?.approveTarget ?? raw.approveTarget ?? sw.tx.to) as string
  ).toLowerCase() as Address;

  // 5. Floor in USDT: router's minReceiveAmount enforces the floor
  const quotedUsdtOut = raw.tokensOut;
  const toleranceBps = BigInt(Math.round(tolerancePct * 100));
  const fallbackFloor = mulDiv(quotedUsdtOut, 10_000n - toleranceBps, 10_000n);
  const minUsdtOut = sw.tx.minReceiveAmount ? BigInt(sw.tx.minReceiveAmount) : fallbackFloor;

  const sharesIn = mulDiv(amountIn, multiplier, E18);
  const usdPerShare = sharesIn > 0n ? Number(quotedUsdtOut) / Number(sharesIn) : 0;
  const ref = await deps.reference(ticker).catch(() => null);

  // 6. Check stock balance, allowance and BNB gas funds
  const [stockBalances, bnbBalResult, allowance, gasPriceWei] = await Promise.all([
    deps.chain.erc20Balances(req.user, [stock]),
    deps.chain.balances(req.user),
    readTokenAllowance(deps, stock, req.user, approveTarget),
    deps.chain.gasPriceWei(),
  ]);

  const stockBal = stockBalances[0] ?? 0n;
  const bnbBal = bnbBalResult.bnb;
  const bnbNeeded = (APPROVE_GAS + gasLimitFromEstimate(ESTIMATED_SWAP_GAS)) * gasPriceWei;

  const base = {
    builtAt: now(),
    expiresAt: now() + QUOTE_FRESH_MS,
    ticker,
    issuer: req.issuer as "ondo" | "bstock",
    symbol: row.symbol,
    stock,
    user: req.user,
    tolerancePct,
    tokensIn: amountIn.toString(),
    sharesIn: sharesIn.toString(),
    quotedUsdtOut: quotedUsdtOut.toString(),
    minUsdtOut: minUsdtOut.toString(),
    multiplier: multiplier.toString(),
    usdPerShare,
    referencePrice: ref?.price ?? null,
    routeText: buildSellRouteText(row.symbol, raw),
    hops: raw.legCount,
    vendor: raw.vendor,
    balances: { tokens: stockBal.toString(), bnb: bnbBal.toString() },
    warnings,
  };

  if (stockBal < amountIn || bnbBal < bnbNeeded) {
    return {
      ...base,
      status: "needs_funds",
      shortfall: {
        tokens: (stockBal < amountIn ? amountIn - stockBal : 0n).toString(),
        bnb: (bnbBal < bnbNeeded ? bnbNeeded - bnbBal : 0n).toString(),
        bnbNeeded: bnbNeeded.toString(),
      },
    };
  }

  if (allowance < amountIn) {
    return {
      ...base,
      status: "needs_approval",
      approve: {
        to: stock,
        spender: approveTarget,
        data: encodeApprove(approveTarget, amountIn),
        amount: amountIn.toString(),
      },
    };
  }

  // 7. Estimate gas and simulate transaction at exact limit
  const txReq: TxRequest = { account: req.user, to: router, data: routerData, value: 0n };
  const est = await deps.chain.estimateGas(txReq);
  if (!est.ok) throw explainRevert(est.reason, est.revertData);

  const limit = gasLimitFromEstimate(est.gas);
  const sim = await deps.chain.simulate(txReq, limit);
  if (!sim.ok) throw explainRevert(sim.reason, sim.revertData);

  let binance: "ok" | "skipped" = "ok";
  let binanceNote: string | undefined;
  try {
    const b = await deps.api.simulate({ from: req.user, to: router, data: routerData });
    if (b.status !== "SUCCESS") {
      throw new TradeError(
        "simulation_reverted",
        "The trade would fail, so nothing was sent.",
        b.failReason ?? b.status,
      );
    }
  } catch (e) {
    if (e instanceof TradeError) throw e;
    binance = "skipped";
    binanceNote = e instanceof Error ? e.message : String(e);
    warnings.push(
      `Binance simulation unavailable (${binanceNote}); the on-chain simulation passed.`,
    );
    deps.onWarn?.(`sell: Binance simulate failed: ${binanceNote}`);
  }

  const bnb = await deps.bnbUsd().catch(() => null);

  return {
    ...base,
    status: "ready",
    tx: {
      to: router,
      data: routerData,
      value: "0x0",
      gasEstimate: est.gas.toString(),
      gasLimit: limit.toString(),
      gasPriceWei: gasPriceWei.toString(),
      feeUsd: bnb === null ? null : feeUsd(Number(limit), gasPriceWei, bnb),
      chainId: BSC_CHAIN_ID,
    },
    simulation: { ethCall: "ok", binance, binanceNote },
  };
}
