import { blockedResponse } from "@/lib/blocked-page";

export const dynamic = "force-static";

/** Direct visits to /blocked get the same page and the same 451 as the gate. */
export function GET() {
  return blockedResponse();
}
