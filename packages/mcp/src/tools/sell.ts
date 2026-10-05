import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Engine } from "@tally/engine";
import { formatUnits } from "@tally/core";
import type { ToolRegistry } from "../registry";
import { ToolError } from "../errors";
import { address, object, only, positive, ticker } from "../input";

/**
 * Registers the build_sell_swap MCP tool (WO-05 contract).
 */
export async function register(
  registry: ToolRegistry,
  engine: Engine,
  options: { enabled?: boolean } = {},
): Promise<void> {
  if (!(options.enabled ?? process.env.FEATURE_SELL === "1")) return;

  const definition: Tool = {
    name: "build_sell_swap",
    description:
      "Build an unsigned sell swap from tokenized stock to USDT using the direct router API swap transaction. Never signs or sends. wallet is the signing wallet. Returns status, minUsdt floor, and unsigned calldata.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: { type: "string", pattern: "^[A-Za-z0-9.]{1,10}$" },
        issuer: { type: "string", enum: ["bstock", "ondo"] },
        wallet: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        shares: { type: "number", exclusiveMinimum: 0 },
        usd: { type: "number", minimum: 6 },
        tokens: { type: "string", pattern: "^\\d+$" },
        tolerancePct: { type: "number", minimum: 0.1, maximum: 5 },
      },
      required: ["ticker", "issuer", "wallet"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };

  registry.add(definition, async (input) => {
    const args = object(input);
    only(args, ["ticker", "issuer", "wallet", "shares", "usd", "tokens", "tolerancePct"]);
    const symbol = ticker(args.ticker);
    if (args.issuer !== "bstock" && args.issuer !== "ondo") {
      throw new ToolError("invalid_request", "Choose bstock or ondo. xStocks are display-only.");
    }
    const wallet = address(args.wallet);
    const tolerancePct =
      args.tolerancePct === undefined ? 1 : positive(args.tolerancePct, "tolerancePct");
    if (tolerancePct < 0.1 || tolerancePct > 5) {
      throw new ToolError("invalid_request", "Tolerance must be between 0.1% and 5%.");
    }

    const shares = args.shares !== undefined ? positive(args.shares, "shares") : undefined;
    const usd = args.usd !== undefined ? positive(args.usd, "usd") : undefined;
    const tokens = typeof args.tokens === "string" ? args.tokens : undefined;

    if (shares === undefined && usd === undefined && tokens === undefined) {
      throw new ToolError("invalid_request", "Specify shares, usd, or tokens to sell.");
    }

    try {
      const plan = await engine.trade.prepareSell({
        ticker: symbol,
        issuer: args.issuer,
        user: wallet,
        shares,
        usd,
        tokens,
        tolerancePct,
      });

      return {
        ...plan,
        unsigned: true,
        signingWallet: wallet,
        minUsdtFloor: formatUnits(BigInt(plan.minUsdtOut), 18),
        quotedUsdt: formatUnits(BigInt(plan.quotedUsdtOut), 18),
        tokensInFormatted: formatUnits(BigInt(plan.tokensIn), 18),
        sharesInFormatted: formatUnits(BigInt(plan.sharesIn), 18),
        factsToShow: {
          ticker: plan.ticker,
          issuer: plan.issuer,
          sharesSold: formatUnits(BigInt(plan.sharesIn), 18),
          quotedUsdtOut: formatUnits(BigInt(plan.quotedUsdtOut), 18),
          minUsdtFloor: formatUnits(BigInt(plan.minUsdtOut), 18),
          usdPerShare: plan.usdPerShare,
          route: plan.routeText,
          expiresAt: plan.expiresAt,
          risks: [
            "Tokenized shares are sold for USDT directly through the aggregator router.",
            "The router's minReceiveAmount protects the floor.",
          ],
        },
      };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolError("sell_failed", message);
    }
  });
}
