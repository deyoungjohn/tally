import type { Session, TokenStatus } from "./types";

export interface RawStatusInfo {
  openState?: boolean | null;
  marketStatus?: string | null;
  reasonCode?: string | null;
  reasonMsg?: string | null;
}

export function sessionFromMarketStatus(s: string | null | undefined): Session {
  switch ((s ?? "").toLowerCase()) {
    case "regular":
    case "trading":
      return "regular";
    case "premarket":
    case "pre_market":
    case "pre":
      return "premarket";
    case "postmarket":
    case "post_market":
    case "afterhours":
    case "after_hours":
    case "post":
      return "postmarket";
    case "overnight":
      return "overnight";
    case "closed":
    case "offhours":
      return "closed";
    case "paused":
      return "unknown"; // A pause identifies availability, not the underlying market session.
    default:
      return "unknown";
  }
}

/**
 * Map Binance `statusInfo` to a status. `null` input means "unknown" and is never assumed open (blueprint §7.4).
 * Observed reason codes (2026-10-02): TRADING, MARKET_PAUSED ("Paused for session transition"), UNSUPPORTED.
 */
export function statusFromInfo(info: RawStatusInfo | null | undefined): TokenStatus | null {
  if (!info) return null;
  const reasonCode = info.reasonCode ?? null;
  const base = {
    reasonCode,
    reasonMsg: info.reasonMsg ?? null,
    session: sessionFromMarketStatus(info.marketStatus),
  };
  const code = (reasonCode ?? "").toUpperCase();
  if ((info.marketStatus ?? "").toLowerCase() === "paused") return { kind: "paused", ...base };
  if (code === "TRADING" && info.openState !== false) return { kind: "open", ...base };
  if (code === "ASSET_LIMITED" || code === "ASSET_LIMITED_EARNINGS")
    return { kind: "limited", ...base };
  if (code === "UNSUPPORTED") return { kind: "unsupported", ...base };
  if (code === "MARKET_PAUSED" || code === "ASSET_PAUSED" || info.openState === false)
    return { kind: "paused", ...base };
  return { kind: "unknown", ...base };
}
