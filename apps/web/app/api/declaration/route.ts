import type { NextRequest } from "next/server";
import { z } from "zod";
import { DECLARATION_VERSION } from "@/lib/declaration";
import { fail, json, rateLimited, tooMany } from "@/lib/server/http";
import { appendJsonl } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const body = z.object({
  version: z.literal(DECLARATION_VERSION),
  accepted: z.literal(true),
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
});

/** Stores the versioned region declaration (blueprint §9.2). The edge gate has already checked the IP's country. */
export async function POST(req: NextRequest) {
  if (rateLimited(req, "declaration", 20)) return tooMany();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "invalid_request", "That request wasn't valid.");
  const stored = await appendJsonl("declarations.jsonl", {
    ...parsed.data,
    at: new Date().toISOString(),
    country: req.headers.get("cf-ipcountry"),
    region: req.headers.get("cf-region-code"),
  });
  return json({ ok: true, stored });
}
