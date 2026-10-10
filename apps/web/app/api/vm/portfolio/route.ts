import type { NextRequest } from "next/server";
import { loadPortfolio } from "@/modules/statement/view-model";
import { vmRoute } from "../_lib";

export const dynamic = "force-dynamic";

/** `held=NVDA,AAPL`: the stocks the page just read from the wallet (see `loadPortfolio`). Anything that is not a ticker is dropped. */
function heldTickers(req: NextRequest): string[] | undefined {
  const raw = req.nextUrl.searchParams.get("held");
  if (raw === null) return undefined;
  return raw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => /^[A-Z0-9.]{1,10}$/.test(t))
    .slice(0, 60);
}

/** Holdings in shares with the issuer breakdown, from the statement module's view model (no floats, no engine route). */
export const GET = (req: NextRequest) =>
  vmRoute(req, "statement", ({ store, wallet }) =>
    loadPortfolio({ walletAddress: wallet, store, heldTickers: heldTickers(req) }),
  );
