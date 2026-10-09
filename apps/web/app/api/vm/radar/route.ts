import type { NextRequest } from "next/server";
import { displayRadar } from "./display";
import type { RadarFilters } from "../../../../modules/flow/view-model";
import { createRadarCache } from "../../../../modules/flow/radar-cache";
import { measureRadarStore, type RadarReadMetrics } from "../../../../modules/flow/radar-metrics";
import { vmRoute } from "../_lib";

export const dynamic = "force-dynamic";

const ISSUERS = ["ondo", "bstock", "xstocks"] as const;
const GRADES = ["A", "B", "C", "D", "F"] as const;
const cachedRadar = createRadarCache();

/**
 * Radar grades and the flow panels from the flow module's view models (market-wide public data: no wallet). Off (404) with
 * the `flow` flag. Optional filters: `issuer`, `grade`, `ghost=1|0`; anything else is ignored.
 */
export const GET = async (req: NextRequest) => {
  const startedAt = performance.now();
  const metrics: RadarReadMetrics = { tokens: new Set(), bytesDecoded: 0 };
  const q = req.nextUrl.searchParams;
  const filters: RadarFilters = {};
  const issuer = q.get("issuer");
  const grade = q.get("grade");
  const ghost = q.get("ghost");
  if (ISSUERS.includes(issuer as never)) filters.issuer = issuer as RadarFilters["issuer"];
  if (GRADES.includes(grade as never)) filters.grade = grade as RadarFilters["grade"];
  if (ghost === "1" || ghost === "0") filters.ghost = ghost === "1";
  try {
    return await vmRoute(
      req,
      "flow",
      async ({ store }) =>
        displayRadar(
          await cachedRadar({
            store: measureRadarStore(store, metrics),
            flowEnabled: true,
            filters,
          }),
        ),
      { wallet: false },
    );
  } finally {
    console.info(
      `radar request: ms=${(performance.now() - startedAt).toFixed(2)} tokens=${metrics.tokens.size} bytesDecoded=${metrics.bytesDecoded}`,
    );
  }
};
