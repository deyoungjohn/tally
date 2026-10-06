import type { NextRequest } from "next/server";
import { loadReceipts } from "@/modules/receipts/view-model";
import { vmRoute } from "../_lib";

export const dynamic = "force-dynamic";

/** A wallet's receipts, newest state first: confirmed, pending and unreconciled, each with its own status and reason. */
export const GET = (req: NextRequest) =>
  vmRoute(req, "receipts", ({ store, wallet }) => loadReceipts({ store, wallet, enabled: true }));
