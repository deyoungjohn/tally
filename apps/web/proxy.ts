import { evaluateRegion } from "@tally/config";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Region gate (blueprint §9). Runs on every request, pages and /api/*, before anything renders.
 * Next 16 renamed `middleware` to `proxy`; this is the same file convention.
 *
 * Cloudflare sets `cf-ipcountry`; `cf-region-code` needs the "Add visitor location headers"
 * managed transform. Missing header = not behind Cloudflare = blocked (fail closed), except
 * when TALLY_ALLOW_MISSING_GEO=1 on a developer machine.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The block page itself and static assets must stay reachable.
  if (pathname === "/blocked") return NextResponse.next();

  const decision = evaluateRegion(
    {
      country: request.headers.get("cf-ipcountry"),
      regionCode: request.headers.get("cf-region-code"),
    },
    { allowMissingHeader: process.env.TALLY_ALLOW_MISSING_GEO === "1" },
  );
  if (!decision.blocked) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "region_blocked", message: "Not available in your region" },
      { status: 451, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Rewrite (not redirect) so the URL stays; the /blocked handler answers with HTTP 451.
  return NextResponse.rewrite(new URL("/blocked", request.url));
}

export const config = {
  // Everything except Next's static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
