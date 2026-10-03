import { readModuleHealth } from "@/components/module-boundary";
import { moduleFlags } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const flags = moduleFlags();
  try {
    return Response.json(
      { health: readModuleHealth(), flags },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.warn("Module health store unavailable");
    return Response.json(
      { health: [], flags, error: "Module health unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
