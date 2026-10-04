import type { Alert, TokenState, UserHolding } from "../types";
import { formatIssuer, type Rule, type RulePorts } from "./interface";

export class PausedRule implements Rule {
  readonly id = "paused";
  readonly name = "Token Paused or Halted";
  readonly description =
    "Alerts when a held token is paused or halted by the issuer or on-chain pause manager.";

  evaluate(
    prev: TokenState | null,
    next: TokenState,
    holding: UserHolding,
    ports?: RulePorts,
  ): Alert[] {
    const issuerLabel = formatIssuer(holding.issuer);
    const wallet = holding.walletAddress.toLowerCase();
    const tokenAddr = next.tokenAddress.toLowerCase();

    // 1. bStock handling:
    // Probe evidence (IDEAS.md §F11 & probe files) proves bStock marketStatus is always null
    // and statusInfo emits TRADING. It emits NOTHING from status, only from on-chain pause evaluation.
    if (next.issuer === "bstock") {
      if (next.isPausedOnchain === null) {
        ports?.onWarn?.(
          `bStock pause state for ${holding.ticker} (${tokenAddr}) is unknown; no pause alert evaluated`,
        );
        return [];
      }

      const isPaused = next.isPausedOnchain === true;
      const wasPaused = prev?.isPausedOnchain === true;

      if (isPaused && !wasPaused) {
        return [
          {
            id: `paused:${wallet}:${tokenAddr}:${next.observedAt}`,
            walletAddress: wallet,
            rule: this.id,
            ticker: holding.ticker,
            issuer: holding.issuer,
            severity: "warning",
            title: `${holding.ticker} via ${issuerLabel} is paused`,
            body: `${holding.ticker} via ${issuerLabel} is paused by its pause manager. Your shares are unchanged.`,
            evidence: {
              snapshotKind: "onchain:pause",
              snapshotKey: tokenAddr,
              observedAt: next.observedAt,
            },
            createdAt: next.observedAt,
          },
        ];
      }
      return [];
    }

    // 2. Ondo (and other issuers with status API):
    // Ondo status comes from statusInfo (marketStatus: 'paused' or reasonCode: 'MARKET_PAUSED' / 'ASSET_PAUSED').
    const isPaused =
      next.status?.kind === "paused" ||
      next.status?.reasonCode === "MARKET_PAUSED" ||
      next.status?.reasonCode === "ASSET_PAUSED";

    const wasPaused =
      prev?.status?.kind === "paused" ||
      prev?.status?.reasonCode === "MARKET_PAUSED" ||
      prev?.status?.reasonCode === "ASSET_PAUSED";

    if (isPaused && !wasPaused) {
      let reasonDetail = "session transition";
      if (next.status?.reasonMsg) {
        const msg = next.status.reasonMsg;
        reasonDetail = msg.toLowerCase().includes("session") ? "session transition" : msg;
      } else if (next.status?.reasonCode) {
        reasonDetail =
          next.status.reasonCode === "MARKET_PAUSED"
            ? "session transition"
            : next.status.reasonCode;
      }

      return [
        {
          id: `paused:${wallet}:${tokenAddr}:${next.observedAt}`,
          walletAddress: wallet,
          rule: this.id,
          ticker: holding.ticker,
          issuer: holding.issuer,
          severity: "warning",
          title: `${holding.ticker} via ${issuerLabel} is paused`,
          body: `${holding.ticker} via ${issuerLabel} is paused: ${reasonDetail}. Your shares are unchanged.`,
          evidence: {
            snapshotKind: "rwa:status",
            snapshotKey: tokenAddr,
            observedAt: next.observedAt,
          },
          createdAt: next.observedAt,
        },
      ];
    }

    return [];
  }
}
