import type { Alert, TokenState, UserHolding } from "../types";
import { formatIssuer, type Rule, type RulePorts } from "./interface";

const GRADE_RANK: Record<string, number> = {
  A: 4,
  B: 3,
  C: 2,
  D: 1,
  F: 0,
};

export class GradeDropRule implements Rule {
  readonly id = "grade-drop";
  readonly name = "Integrity Grade Dropped";
  readonly description = "Alerts when a token's integrity grade from the Radar snapshot drops.";

  evaluate(
    prev: TokenState | null,
    next: TokenState,
    holding: UserHolding,
    _ports?: RulePorts,
  ): Alert[] {
    if (!prev?.grade || !next.grade) {
      return [];
    }

    const prevRank = GRADE_RANK[prev.grade];
    const nextRank = GRADE_RANK[next.grade];

    if (prevRank === undefined || nextRank === undefined || nextRank >= prevRank) {
      return [];
    }

    const issuerLabel = formatIssuer(holding.issuer);
    const wallet = holding.walletAddress.toLowerCase();
    const tokenAddr = next.tokenAddress.toLowerCase();

    // Finding 1: Grade drop lists reasons from the Radar snapshot directly, never status.reasonMsg
    const reasonDetail =
      next.gradeReasons.length > 0
        ? next.gradeReasons.join("; ")
        : "reason not recorded in the snapshot";

    const body = `${holding.ticker} via ${issuerLabel} dropped ${prev.grade} → ${next.grade}: ${reasonDetail}.`;

    return [
      {
        id: `grade-drop:${wallet}:${tokenAddr}:${next.observedAt}`,
        walletAddress: wallet,
        rule: this.id,
        ticker: holding.ticker,
        issuer: holding.issuer,
        severity: nextRank <= 1 ? "critical" : "warning",
        title: `${holding.ticker} via ${issuerLabel} grade dropped`,
        body,
        evidence: {
          snapshotKind: "radar",
          snapshotKey: tokenAddr,
          observedAt: next.observedAt,
        },
        createdAt: next.observedAt,
      },
    ];
  }
}
