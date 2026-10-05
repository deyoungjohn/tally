export class ToolError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
  }
}

export function isMissingCredentialsError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return (
    typeof message === "string" &&
    message.startsWith("BINANCE_W3_API_KEY and BINANCE_W3_API_SECRET are not set")
  );
}

/** Never expose arbitrary upstream messages (they can contain credential-bearing transport URLs). */
export function plainError(error: unknown): { kind: string; message: string } {
  if (isMissingCredentialsError(error))
    return {
      kind: "auth",
      message:
        "Data-provider credentials are not set in this environment. Load the Tally API credentials, then retry. No transaction was sent.",
    };
  if (error instanceof ToolError) return { kind: error.kind, message: error.message };
  const e = error as { kind?: unknown; code?: unknown; message?: unknown } | null;
  const kind = typeof e?.kind === "string" ? e.kind : "unavailable";
  const code = String(e?.code ?? "");
  if (code === "40103")
    return { kind: "auth", message: "Request timestamp rejected: check this machine's clock" };
  if (code === "40101" || code === "40102")
    return { kind: "auth", message: "API key or signature rejected" };
  if (code === "40375" || kind === "below_minimum")
    return { kind: "below_minimum", message: "Minimum order is 6 USDT." };
  if (code === "40304" || kind === "region_block")
    return {
      kind: "region_block",
      message:
        "Quotes are temporarily unavailable: the data provider refuses this server's region.",
    };
  if (kind === "feed_stale" || kind === "feed_blocked")
    return {
      kind: "share_data_refreshing",
      message: "Share data is being refreshed. Use the web app; MCP cannot sign a feed update.",
    };
  if (
    kind === "token_paused" ||
    kind === "guard_paused" ||
    (kind === "not_buyable" && typeof e?.message === "string" && /paused/i.test(e.message))
  )
    return { kind: "paused", message: "Trading is paused. No transaction was sent." };
  if (
    kind === "not_buyable" &&
    typeof e?.message === "string" &&
    /ghost|almost no|liquidity/i.test(e.message)
  )
    return {
      kind: "ghost",
      message:
        "Ghost market: almost no trading on BNB Chain. This token cannot be bought through Tally.",
    };
  const messages: Record<string, string> = {
    not_buyable: "This token cannot be bought through the deployed ShareGuard.",
    invalid_request: "The trade request is invalid. Tolerance must be between 0.1% and 5%.",
    router_not_allowed: "The route is not approved by ShareGuard.",
    rfq_required: "This issuer needs a signed order. Try the other issuer.",
    price_moved: "The price moved beyond the share floor. Review a fresh quote.",
    simulation_reverted: "The trade would fail. No transaction was sent.",
    gas_estimate_failed: "The network fee estimate failed. No transaction was sent.",
    route_failed: "No usable route is available. Request a fresh quote.",
    expired: "The quote expired. Request a fresh plan.",
    param: "Ticker or parameters are unavailable. Check the request.",
    auth: "Data-provider authentication is unavailable on this server.",
  };
  return {
    kind,
    message: messages[kind] ?? "Tally data is temporarily unavailable. No transaction was sent.",
  };
}
