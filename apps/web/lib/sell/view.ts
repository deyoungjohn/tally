// Client-side view of a sell plan (the SellSheet view model's job, built from the plan itself: `loadSellSheet` is a stub with
// fixed numbers, so nothing here comes from it). Every number shown is a value the plan returned; nothing is recomputed from
// a displayed float, and wording states facts without advice.

import { MIN_SELL_USDT } from "@tally/config";
import type { SellPlan } from "@tally/engine";

export type SellStatus = SellPlan["status"];

/** 1e18 fixed-point integer string to a trimmed decimal string (display only). */
export function fromE18(raw: string, maxDecimals = 6): string {
  const n = BigInt(raw);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 10n ** 18n;
  let frac = (abs % 10n ** 18n).toString().padStart(18, "0").slice(0, maxDecimals);
  frac = frac.replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

export const usdtText = (raw: string) => `${fromE18(raw, 4)} USDT`;
export const sharesText = (raw: string) => fromE18(raw, 6);
export const tokensText = (raw: string, symbol: string) => `${fromE18(raw, 8)} ${symbol}`;
export const bnbText = (raw: string) => `${fromE18(raw, 6)} BNB`;

export interface SellSheetView {
  status: SellStatus;
  ticker: string;
  symbol: string;
  issuer: "ondo" | "bstock";
  /** What the person sends. */
  sharesIn: string;
  tokensIn: string;
  /** What the router quotes, and the least it will pay (the router enforces it on-chain). */
  expectedUsdt: string;
  minUsdt: string;
  routeText: string;
  vendor: string;
  hops: number;
  feeUsd: number | null;
  tolerancePct: number;
  warnings: string[];
  /** needs_funds only: what is missing. */
  shortfall: { tokens: string | null; bnb: string | null } | null;
  builtAt: number;
  expiresAt: number;
  /** Raw balance of the token, exactly as the plan returned it. "Sell all" sends this string. */
  rawTokenBalance: string;
  /** What the sheet's primary action does next. */
  next: "fund" | "approve" | "confirm";
}

/** Notes from the engine can carry provider text in parentheses or a URL; only the plain part is shown. */
export function plainWarning(w: string): string | null {
  const stripped = w
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/https?:\/\//i.test(stripped)) return null;
  if (/^Binance simulation unavailable/i.test(stripped))
    return "The second simulation check was unavailable. The on-chain simulation passed.";
  if (/token allowance/i.test(stripped))
    return "The existing token approval couldn't be read, so an approval step is shown.";
  return stripped.length > 0 && stripped.length < 160 ? stripped : null;
}

export function toSellSheet(plan: SellPlan): SellSheetView {
  const short = plan.shortfall;
  return {
    status: plan.status,
    ticker: plan.ticker,
    symbol: plan.symbol,
    issuer: plan.issuer,
    sharesIn: plan.sharesIn,
    tokensIn: plan.tokensIn,
    expectedUsdt: plan.quotedUsdtOut,
    minUsdt: plan.minUsdtOut,
    routeText: plan.routeText,
    vendor: plan.vendor,
    hops: plan.hops,
    feeUsd: plan.tx?.feeUsd ?? null,
    tolerancePct: plan.tolerancePct,
    warnings: plan.warnings.map(plainWarning).filter((w): w is string => w !== null),
    shortfall: short
      ? {
          tokens: BigInt(short.tokens) > 0n ? short.tokens : null,
          bnb: BigInt(short.bnb) > 0n ? short.bnb : null,
        }
      : null,
    builtAt: plan.builtAt,
    expiresAt: plan.expiresAt,
    rawTokenBalance: plan.balances.tokens,
    next:
      plan.status === "needs_funds"
        ? "fund"
        : plan.status === "needs_approval"
          ? "approve"
          : "confirm",
  };
}

/** True when the fresh plan's guaranteed minimum is worse than the plan the person saw, or it sells a different amount. */
export function planGotWorse(seen: SellPlan, fresh: SellPlan): boolean {
  return BigInt(fresh.minUsdtOut) < BigInt(seen.minUsdtOut) || fresh.tokensIn !== seen.tokensIn;
}

export type SellErrorKind =
  | "refused"
  | "below_minimum"
  | "busy"
  | "region"
  | "unavailable"
  | "changed"
  | "rejected"
  | "failed";

export interface SellFailure {
  kind: SellErrorKind;
  /** Plain words. Never raw error text, URLs or provider details. */
  message: string;
}

const KNOWN_REFUSALS: [RegExp, string][] = [
  [/^No market to exit/i, "No market to exit this token on BNB Chain."],
  [/can't be traded through Tally yet/i, "This stock can't be sold through Tally yet."],
  [/isn't available from this issuer/i, "This token isn't available to sell on BNB Chain."],
  [/needs a signed order/i, "This issuer needs a signed order, which Tally can't send yet."],
];

/** Maps whatever the plan route or the wallet threw to one fixed sentence. */
export function explainSellError(e: unknown): SellFailure {
  const k = (e as { kind?: string }).kind ?? "";
  const msg = e instanceof Error ? e.message : "";
  if ((e as { code?: number }).code === 4001)
    return { kind: "rejected", message: "You cancelled in your wallet. Nothing was sold." };
  // The region gate answers a blocked visitor with a 451 page, and an off feature answers 404: neither has a JSON body.
  if (/HTTP 451/.test(msg))
    return { kind: "region", message: "Tally isn't available from this region." };
  if (/HTTP 404/.test(msg))
    return { kind: "unavailable", message: "Selling isn't available right now." };
  switch (k) {
    case "below_minimum":
      return {
        kind: "below_minimum",
        message: `The sale is below the $${MIN_SELL_USDT} minimum order. Transaction will fail.`,
      };
    case "quotes_unavailable":
      return {
        kind: "region",
        message: "Quotes are unavailable from this region right now. Nothing was sold.",
      };
    case "busy":
    case "rate_limited":
      return { kind: "busy", message: "Busy right now. Try again in a few seconds." };
    case "upstream":
      return { kind: "unavailable", message: "The price source couldn't be reached. Try again." };
    case "not_buyable": {
      const hit = KNOWN_REFUSALS.find(([re]) => re.test(msg));
      return {
        kind: "refused",
        message: hit ? hit[1] : "This token can't be sold through Tally right now.",
      };
    }
    case "rfq_required":
      return {
        kind: "refused",
        message: "This issuer needs a signed order, which Tally can't send yet.",
      };
    case "router_not_allowed":
      return {
        kind: "refused",
        message: "The sell route isn't on the allow list, so nothing was sent.",
      };
    case "route_failed":
      return { kind: "unavailable", message: "No route was found for this sale right now." };
    case "simulation_reverted":
    case "token_paused":
      return {
        kind: "unavailable",
        message: "The sale would fail right now, so nothing was sent.",
      };
    case "invalid_request":
      return { kind: "failed", message: "That amount can't be sold. Check it and try again." };
    // The wallet's own refusals, already put into plain words by `friendlyWalletError` (not enough BNB for the fee, a busy wallet).
    case "needs_gas":
    case "nonce":
    case "underpriced":
      return { kind: "failed", message: msg };
    default:
      return { kind: "failed", message: "Something went wrong. Nothing was sold." };
  }
}
