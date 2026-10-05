import { E18 } from "@tally/core";
import {
  applyLegResult,
  PIE_TEMPLATES,
  rebalancePlan,
  type PieRun,
  type RebalanceInput,
} from "@tally/mod-pies";
import {
  buildPieTemplatesVM,
  buildPieVM,
  buildRebalancePlanVM,
  type PiesViewModel,
} from "./view-model";

/** Constructed data for the dev preview; never represents real wallet observations. */
export function previewPies(): PiesViewModel {
  const input: RebalanceInput = {
    template: PIE_TEMPLATES[0]!,
    buyable: new Set(["NVDA", "AAPL", "TSLA", "QQQ", "SPY"]),
    holdings: [
      {
        ticker: "NVDA",
        issuer: "ondo",
        tokenContractAddress: "preview-ondo",
        balanceTokens: E18,
        balanceShares: 10n * E18,
      },
    ],
    prices: {
      NVDA: { usdPerShareE18: 10n * E18 },
      AAPL: { usdPerShareE18: 10n * E18 },
      TSLA: { usdPerShareE18: 10n * E18 },
    },
    walletUsdtE18: 0n,
    mode: "rebalance",
    bestIssuer: (ticker) => ({ issuer: "bstock", tokenContractAddress: `preview-${ticker}` }),
  };
  const plan = rebalancePlan(input);
  const run: PieRun = {
    id: "preview-run",
    wallet: "constructed preview",
    pieId: input.template.id,
    createdAt: 1791022800000,
    legs: plan.legs.map((leg) => ({ id: leg.id, status: "pending" })),
  };
  const done = applyLegResult(run, run.legs[0]!.id, {
    status: "done",
    txHash: "preview-sell-receipt",
  });
  const partial = applyLegResult(done, run.legs[1]!.id, {
    status: "failed",
    reason: "Constructed failure: user rejected",
  });
  const meta = { stale: true, ageMs: 600000, source: "constructed preview", error: null };
  return {
    ...meta,
    state: "ready",
    empty: false,
    reason: "Constructed preview data",
    templates: buildPieTemplatesVM(input.buyable, meta),
    pie: buildPieVM(input, meta),
    plan: buildRebalancePlanVM(plan, partial, meta),
    notes: [],
  };
}
