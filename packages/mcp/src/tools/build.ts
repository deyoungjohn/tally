import { formatUnits } from "@tally/core";
import { SHAREGUARD_DEPLOYED, USDT_BSC } from "@tally/config";
import { QUOTE_FRESH_MS } from "@tally/engine";
import { freshness } from "../freshness";
import { address, floorShares, object, only, positive, ticker } from "../input";
import { ToolError } from "../errors";
import type { Runtime } from "../runtime";

/** Adapts intent only. The unchanged engine prepares, estimates and simulates the transaction. */
export async function buildGuardedSwap(runtime: Runtime, input: unknown) {
  const args = object(input);
  only(args, [
    "ticker",
    "issuer",
    "usdtAmount",
    "wallet",
    "recipient",
    "minShares",
    "tolerancePct",
  ]);
  const symbol = ticker(args.ticker);
  if (args.issuer !== "bstock" && args.issuer !== "ondo")
    throw new ToolError("invalid_request", "Choose bstock or ondo. xStocks are display-only.");
  const wallet = address(args.wallet);
  const recipient = args.recipient === undefined ? wallet : address(args.recipient);
  if (recipient.toLowerCase() !== wallet.toLowerCase())
    throw new ToolError("invalid_recipient", "Recipient must equal the signing wallet.");
  if (args.minShares !== undefined && args.tolerancePct !== undefined)
    throw new ToolError("invalid_request", "Provide minShares or tolerancePct, never both.");
  const usd = positive(args.usdtAmount, "usdtAmount");
  if (usd < 6) throw new ToolError("below_minimum", "Minimum order is 6 USDT.");
  let tolerance = args.tolerancePct === undefined ? 1 : positive(args.tolerancePct, "tolerancePct");
  if (tolerance < 0.1 || tolerance > 5)
    throw new ToolError("invalid_request", "Tolerance must be between 0.1% and 5%.");
  const requested = args.minShares === undefined ? undefined : floorShares(args.minShares);
  if (requested !== undefined) {
    const quote = await runtime.engine.quote({ ticker: symbol, amount: { usd } });
    const row = quote.rows.find((row) => row.issuer === args.issuer);
    // Integer basis points, rounded down so the derived floor cannot be weaker than the intent.
    const quoted = row?.sharesOut;
    if (quoted && quoted > 0n) {
      const bps = ((quoted - requested) * 10_000n) / quoted;
      tolerance = Number(bps < 10n ? 10n : bps > 500n ? 500n : bps) / 100;
    } else tolerance = 0.1;
  }
  if (runtime.engine.trade.guard.toLowerCase() !== SHAREGUARD_DEPLOYED.toLowerCase())
    throw new ToolError("invalid_guard", "MCP requires the deployed ShareGuard address.");
  const plan = await runtime.engine.trade.prepare({
    ticker: symbol,
    issuer: args.issuer,
    usd,
    tolerancePct: tolerance,
    user: wallet,
  });
  // A runtime built without a signer can never produce this, but reject an injected unsafe engine too.
  if (plan.feedUpdate)
    throw new ToolError(
      "share_data_refreshing",
      "Share data is being refreshed. Use the web app; MCP cannot sign a feed update.",
    );
  if (requested !== undefined && BigInt(plan.minShares) < requested)
    throw new ToolError(
      "floor_not_achievable",
      `The fresh plan uses a floor of ${formatUnits(BigInt(plan.minShares), 18)} shares; requested at least ${formatUnits(requested, 18)}. That floor is not achievable within 0.1–5% tolerance. Review a fresh quote or change the amount.`,
    );
  const state = freshness(runtime, new Date(plan.builtAt).toISOString(), QUOTE_FRESH_MS);
  if (state.stale || runtime.now() >= plan.expiresAt)
    throw new ToolError("expired", "The quote expired. Request a fresh plan.");
  return {
    ...plan,
    unsigned: true,
    fixtures: runtime.fixtures,
    freshness: state,
    signingWallet: wallet,
    recipient,
    approval: { token: USDT_BSC, spender: SHAREGUARD_DEPLOYED, amount: plan.amountInUsdt },
    requestedMinShares: requested?.toString() ?? null,
    floorShares: formatUnits(BigInt(plan.minShares), 18),
    factsToShow: {
      spendUsdt: formatUnits(BigInt(plan.amountInUsdt), 18),
      issuer: plan.issuer,
      shareFloor: formatUnits(BigInt(plan.minShares), 18),
      sharesPerToken: formatUnits(BigInt(plan.multiplier), 18),
      multiplierSource:
        plan.issuer === "bstock"
          ? "onchain uiMultiplier()"
          : "fresh stored ShareGuard feed, checked against the engine's accepted Ondo reading",
      route: plan.routeText,
      premium: plan.premium,
      expiresAt: plan.expiresAt,
      risks: [
        "Tokenized shares are not the underlying shares.",
        "Issuer, smart-contract and price-movement risks apply.",
        "Only the onchain share floor is guaranteed; quoted output can change.",
      ],
    },
  };
}
