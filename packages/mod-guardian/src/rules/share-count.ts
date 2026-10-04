import { corporateActionKind, JUMP_LIMIT_PPM, matchSimpleRatio, mulDiv } from "@tally/core";
import type { Alert, TokenState, UserHolding } from "../types";
import { formatIssuer, type Rule, type RulePorts } from "./interface";

export class ShareCountRule implements Rule {
  readonly id = "share-count";
  readonly name = "Share Count Changed";
  readonly description =
    "Alerts when a token's share multiplier changes, explaining whether it was a dividend, stock split, or unknown change.";

  evaluate(
    prev: TokenState | null,
    next: TokenState,
    holding: UserHolding,
    _ports?: RulePorts,
  ): Alert[] {
    if (!prev?.multiplier || !next.multiplier || prev.multiplier === next.multiplier) {
      return [];
    }

    const prevM = prev.multiplier;
    const nextM = next.multiplier;
    const issuerLabel = formatIssuer(holding.issuer);

    const isIncrease = nextM > prevM;
    const diff = isIncrease ? nextM - prevM : prevM - nextM;
    const ppm = Number(mulDiv(diff, 1_000_000n, prevM));
    const pct = (ppm / 10_000).toFixed(1);

    let explanation = "reason unknown";

    if (isIncrease) {
      if (ppm <= JUMP_LIMIT_PPM) {
        // Increases <= 3% are ordinary distribution/dividend reinvestments
        explanation = "dividend reinvested";
      } else {
        const ratio = matchSimpleRatio(nextM, prevM);
        const action = corporateActionKind(next.status?.reasonMsg);
        if (ratio) {
          explanation = `${ratio.label}:1 stock split`;
        } else if (action) {
          explanation = action.replace("_", " ");
        }
      }
    } else {
      // Decreases
      const ratio = matchSimpleRatio(nextM, prevM);
      const action = corporateActionKind(next.status?.reasonMsg);
      if (ratio) {
        explanation = `${ratio.label} reverse split`;
      } else if (action) {
        explanation = action.replace("_", " ");
      }
    }

    const verb = isIncrease ? "rose" : "decreased";
    const body = `Your token count is the same; your shares ${verb} ${pct}% (${explanation}).`;

    return [
      {
        id: `share-count:${next.tokenAddress.toLowerCase()}:${next.observedAt}`,
        rule: this.id,
        ticker: holding.ticker,
        issuer: holding.issuer,
        severity: "info",
        title: `${holding.ticker} via ${issuerLabel} share multiplier changed`,
        body,
        evidence: {
          snapshotKind: "multiplier",
          snapshotKey: next.tokenAddress.toLowerCase(),
          observedAt: next.observedAt,
        },
        createdAt: next.observedAt,
      },
    ];
  }
}
