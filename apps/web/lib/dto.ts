/** JSON-safe shapes the API returns to the browser (no bigint). Mapped from core's types on the server only. */
export type Issuer = "ondo" | "bstock" | "xstocks";
export type Grade = "A" | "B" | "C" | "D" | "F";

export interface RowDto {
  symbol: string;
  issuer: Issuer;
  executable: boolean;
  notExecutableReason?: string;
  /** Shares you get for the amount, as a plain number (display only; the contract does the real maths in bigint). */
  shares?: number;
  /** USDT spent for those shares (about $1 each). */
  amountUsd?: number;
  usdPerShare?: number;
  /** Fraction vs the US price (0.0012 = +0.12%). */
  premium?: number;
  hops?: number;
  routeText?: string;
  feeUsd?: number;
  grade: Grade;
  gradeReasons: string[];
  flags: string[];
  unitTrap: boolean;
  /** Shares per token (e.g. 10 for Ondo NFLX). */
  multiplier?: number;
  isBest: boolean;
  rank?: number;
  error?: string;
}

export interface QuoteDto {
  ticker: string;
  asOf: string;
  usd?: number;
  shares?: number;
  referencePrice: number | null;
  session: string;
  rows: RowDto[];
  best?: string;
  saving?: { usd: number; pct: number; vsSymbol: string };
  warnings: string[];
}

export interface ApiError {
  error: { kind: string; message: string };
}

export type PlanStatus = "needs_funds" | "needs_approval" | "ready";

export interface PlanDto {
  status: PlanStatus;
  builtAt: number;
  expiresAt: number;
  ticker: string;
  issuer: "ondo" | "bstock";
  symbol: string;
  stock: string;
  guard: string;
  tolerancePct: number;
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
  feedUpdate: boolean;
  balances: { usdt: string; bnb: string };
  shortfall?: { usdt: string; bnb: string; bnbNeeded: string };
  approve?: { to: string; data: string; amount: string };
  tx?: {
    to: string;
    data: string;
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

export interface ReceiptDto {
  status: "pending" | "success" | "reverted";
  txHash: string;
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
    stock: string;
    user: string;
  };
  bscscan: string;
  warning?: string;
}

export interface FillDto {
  txHash: string;
  at: number;
  ticker: string;
  symbol: string;
  shares: number;
  premium: number | null;
  usdPerShare: number;
}
