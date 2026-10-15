import type { NextRequest } from "next/server";
import { z } from "zod";
import { isBuyable, TICKER_RE } from "@/lib/tickers";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, fail, json, rateLimited, tooMany } from "@/lib/server/http";
import { PLAN_KIND, planKey, type PlanRecord } from "@tally/mod-receipts";
import { openStore } from "@tally/modkit";

export const dynamic = "force-dynamic";

let store: ReturnType<typeof openStore> | undefined;

/**
 * Remember the quote Tally just issued, keyed by the user and the hash of the calldata it hands out. When that transaction is
 * signed and mined, the receipts worker finds this record and compares the fill with a quote Tally itself recorded, not with a
 * browser's report. Best effort: a failure here never touches the plan.
 */
async function recordPlan(
  user: string,
  plan: Awaited<ReturnType<Awaited<ReturnType<typeof getEngine>>["trade"]["prepare"]>>,
) {
  if (process.env.FEATURE_RECEIPTS !== "1" || plan.status !== "ready" || !plan.tx) return;
  try {
    const now = Date.now();
    const record: PlanRecord = {
      user: user as PlanRecord["user"],
      to: plan.tx.to as PlanRecord["to"],
      quote: {
        stock: plan.stock as PlanRecord["to"],
        issuer: plan.issuer,
        tokensOut: plan.tokensOut,
        multiplier: plan.multiplier,
        minShares: plan.minShares,
        amountInUsdt: plan.amountInUsdt,
        hops: plan.hops,
        routeText: plan.routeText,
        builtAt: plan.builtAt,
        expiresAt: plan.expiresAt,
      },
      recordedAt: now,
    };
    (store ??= openStore()).put({
      kind: PLAN_KIND,
      key: await planKey(user, plan.tx.data),
      source: "server-plan",
      observedAt: now,
      data: record,
    });
  } catch {
    console.warn("plan quote could not be recorded; the plan is unaffected");
  }
}

const body = z.object({
  ticker: z.string().toUpperCase().regex(TICKER_RE),
  issuer: z.enum(["ondo", "bstock"]),
  usd: z.number().positive().max(10_000),
  tolerancePct: z.number().min(0.1).max(5).optional(),
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

/**
 * Trade plan (blueprint §7.6). Always re-quotes. Returns one of: needs_funds, needs_approval (exact amount), or ready
 * (calldata, gas limit = estimate × 1.25, simulated at that limit). Call again when `expiresAt` passes or after the approval mines.
 */
export async function POST(req: NextRequest) {
  if (rateLimited(req, "plan", 30)) return tooMany();
  try {
    const b = body.parse(await req.json());
    if (!isBuyable(b.ticker))
      return fail(409, "not_buyable", `${b.ticker} can't be bought through Tally yet.`);
    const engine = await getEngine();
    const plan = await engine.trade.prepare({
      ticker: b.ticker,
      issuer: b.issuer,
      usd: b.usd,
      tolerancePct: b.tolerancePct,
      user: b.user as `0x${string}`,
    });
    await recordPlan(b.user, plan);
    return json(plan);
  } catch (e) {
    return errorResponse(e);
  }
}
