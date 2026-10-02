import type { NextRequest } from "next/server";
import { json, rateLimited, tooMany } from "@/lib/server/http";
import { readJsonl } from "@/lib/server/store";
import type { FillDto } from "@/lib/dto";

export const dynamic = "force-dynamic";

/** Recent real fills, newest first (the landing page's notification stack). */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "fills", 30)) return tooMany();
  const rows = await readJsonl<FillDto>("fills.jsonl", 10);
  return json(rows.reverse());
}
