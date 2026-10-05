import { corporateActionKind, JUMP_LIMIT_PPM, matchSimpleRatio, mulDiv } from "@tally/core";
import type { Alert, TokenState, UserHolding } from "../types";
import { formatIssuer, type Rule, type RulePorts } from "./interface";

function formatRatio(label: string): string {
  if (label.includes("/")) {
    return label.replace("/", ":");
  }
  return `${label}:1`;
}

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
    const wallet = holding.walletAddress.toLowerCase();
    const tokenAddr = next.tokenAddress.toLowerCase();

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
        if (action) {
          const actionText = action.replace("_", " ");
          explanation = ratio ? `${formatRatio(ratio.label)} ${actionText}` : actionText;
        } else if (ratio) {
          explanation = `reason unknown (the ratio is about ${formatRatio(ratio.label)}, but there is no corporate-action status)`;
        } else {
          explanation = "reason unknown";
        }
      }
    } else {
      // Decreases
      const ratio = matchSimpleRatio(nextM, prevM);
      const action = corporateActionKind(next.status?.reasonMsg);
      if (action) {
        const actionText = action === "stock_split" ? "reverse split" : action.replace("_", " ");
        explanation = ratio ? `${formatRatio(ratio.label)} ${actionText}` : actionText;
      } else if (ratio) {
        explanation = `reason unknown (the ratio is about ${formatRatio(ratio.label)}, but there is no corporate-action status)`;
      } else {
        explanation = "reason unknown";
      }
    }

    const verb = isIncrease ? "rose" : "decreased";
    const body = `Your token count is the same; your shares ${verb} ${pct}% (${explanation}).`;

    return [
      {
        id: `share-count:${wallet}:${tokenAddr}:${next.observedAt}`,
        walletAddress: wallet,
        rule: this.id,
        ticker: holding.ticker,
        issuer: holding.issuer,
        severity: "info",
        title: `${holding.ticker} via ${issuerLabel} share multiplier changed`,
        body,
        evidence: {
          snapshotKind: "multiplier",
          snapshotKey: tokenAddr,
          observedAt: next.observedAt,
        },
        createdAt: next.observedAt,
      },
    ];
  }
}
