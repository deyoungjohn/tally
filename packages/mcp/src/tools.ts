import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Runtime } from "./runtime";
import { ToolRegistry } from "./registry";
import { getConsolidatedQuote } from "./tools/quote";
import { getSharesOf } from "./tools/shares";
import { getIntegrity } from "./tools/integrity";
import { buildGuardedSwap } from "./tools/build";

const ticker = { type: "string", pattern: "^[A-Za-z0-9.]{1,10}$" };
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const positive = { type: "number", exclusiveMinimum: 0 };
const definitions: Tool[] = [
  {
    name: "get_consolidated_quote",
    description:
      "Compare every issuer using the web engine: shares, price per share, premium fraction, estimated fee, route, integrity and best flag. Provide usd or shares.",
    inputSchema: {
      type: "object",
      properties: { ticker, usd: positive, shares: positive },
      required: ["ticker"],
      additionalProperties: false,
      oneOf: [
        { required: ["usd"], not: { required: ["shares"] } },
        { required: ["shares"], not: { required: ["usd"] } },
      ],
    },
  },
  {
    name: "get_shares_of",
    description:
      "Read balances in bigint shares across issuers. Unknown balances/multipliers are null with reasons. Default coverage NVDA,AAPL,TSLA,QQQ,SPY,NFLX; optional tickers extends or changes scope.",
    inputSchema: {
      type: "object",
      properties: {
        address,
        tickers: { type: "array", items: ticker, minItems: 1, maxItems: 100 },
      },
      required: ["address"],
      additionalProperties: false,
    },
  },
  {
    name: "get_integrity",
    description:
      "Trap Shield grades, reasons, ghost and paused flags. Omit ticker for NVDA,AAPL,TSLA,QQQ,SPY,NFLX.",
    inputSchema: { type: "object", properties: { ticker }, additionalProperties: false },
  },
  {
    name: "build_guarded_swap",
    description:
      "Build an unsigned ShareGuard buy using the unchanged web plan. Never signs or sends. wallet is the signing wallet; recipient must match. minShares is a human decimal at-least constraint; tolerance is percent (default 1). Passes needs_funds/needs_approval through. Rebuild after approval and expiry.",
    inputSchema: {
      type: "object",
      properties: {
        ticker,
        issuer: { type: "string", enum: ["bstock", "ondo"] },
        usdtAmount: { type: "number", minimum: 6 },
        wallet: address,
        recipient: address,
        minShares: { type: "string", pattern: "^\\d+(?:\\.\\d{1,18})?$" },
        tolerance: { type: "number", minimum: 0.1, maximum: 5 },
      },
      required: ["ticker", "issuer", "usdtAmount", "wallet"],
      additionalProperties: false,
      not: { required: ["minShares", "tolerance"] },
    },
  },
];

export function registerTools(runtime: Runtime, registry = new ToolRegistry()): ToolRegistry {
  const handlers = [getConsolidatedQuote, getSharesOf, getIntegrity, buildGuardedSwap];
  for (const [i, definition] of definitions.entries())
    registry.add(
      {
        ...definition,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: !runtime.fixtures,
        },
      },
      (args) => handlers[i]!(runtime, args),
    );
  return registry;
}
