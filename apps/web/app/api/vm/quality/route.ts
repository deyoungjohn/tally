import type { NextRequest } from "next/server";
import { loadQuality } from "@/modules/quality/view-model";
import { vmRoute } from "../_lib";

export const dynamic = "force-dynamic";

/** Execution quality from the quality module's view model (market-wide: no wallet). Off (404) with the `quality` flag. The page polls this. */
export const GET = (req: NextRequest) =>
  vmRoute(req, "quality", async ({ store }) => loadQuality({ store }), { wallet: false });
