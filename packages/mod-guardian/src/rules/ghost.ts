import type { Alert, TokenState, UserHolding } from "../types";
import { formatIssuer, type Rule, type RulePorts } from "./interface";

export class GhostRule implements Rule {
  readonly id = "ghost";
  readonly name = "No Exit Market (Ghost)";
  readonly description = "Alerts when a token has no executable exit liquidity on BNB Chain.";

  evaluate(
    prev: TokenState | null,
    next: TokenState,
    holding: UserHolding,
    _ports?: RulePorts,
  ): Alert[] {
    // Only alert when the token transitions to ghost status
    const isGhost = next.ghost === true;
    const wasGhost = prev?.ghost === true;

    if (!isGhost || wasGhost) {
      return [];
    }

    const issuerLabel = formatIssuer(holding.issuer);
    const body = "There's no market to sell this token on BNB Chain right now.";

    return [
      {
        id: `ghost:${next.tokenAddress.toLowerCase()}:${next.observedAt}`,
        rule: this.id,
        ticker: holding.ticker,
        issuer: holding.issuer,
        severity: "critical",
        title: `${holding.ticker} via ${issuerLabel} has no exit market`,
        body,
        evidence: {
          snapshotKind: next.evidenceKey ?? "flow-ghost",
          snapshotKey: next.tokenAddress.toLowerCase(),
          observedAt: next.observedAt,
        },
        createdAt: next.observedAt,
      },
    ];
  }
}
