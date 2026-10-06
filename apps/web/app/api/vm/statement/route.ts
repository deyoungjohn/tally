import type { NextRequest } from "next/server";
import { loadStatement } from "@/modules/statement/view-model";
import { vmRoute } from "../_lib";

export const dynamic = "force-dynamic";

export const GET = (req: NextRequest) =>
  vmRoute(req, "statement", ({ store, wallet }) => loadStatement({ walletAddress: wallet, store }));
