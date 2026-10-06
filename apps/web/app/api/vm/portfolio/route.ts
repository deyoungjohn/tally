import type { NextRequest } from "next/server";
import { loadPortfolio } from "@/modules/statement/view-model";
import { vmRoute } from "../_lib";

export const dynamic = "force-dynamic";

/** Holdings in shares with the issuer breakdown, from the statement module's view model (no floats, no engine route). */
export const GET = (req: NextRequest) =>
  vmRoute(req, "statement", ({ store, wallet }) => loadPortfolio({ walletAddress: wallet, store }));
