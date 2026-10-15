import type { Address } from "@tally/core";
import type { QuoteHint } from "./hints";

// A quote Tally itself issued. When the web server builds a buy plan it records the quote here, keyed by who the plan is for and a
// hash of the exact calldata it handed out. The receipts worker, verifying a signed transaction, looks the transaction up by the same
// key: a match proves the quote came from Tally (the user signed the very bytes we built), so the fill is compared against a
// server-recorded quote instead of one a browser reported. No match keeps the old behaviour: the browser's hint, marked as such.

export const PLAN_KIND = "plan-quote";
/** A recorded plan is looked up for an hour after it was issued. */
export const PLAN_MAX_AGE_MS = 60 * 60_000;

export interface PlanRecord {
  user: Address;
  /** The contract the plan's transaction goes to (the guard). */
  to: Address;
  quote: QuoteHint;
  recordedAt: number;
}

/** `<user>:<sha256 of the calldata>`. Async because it uses the platform's Web Crypto (browser, Node and workers alike). */
export async function planKey(user: string, calldata: string): Promise<string> {
  const bytes = new TextEncoder().encode(calldata.toLowerCase());
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return `${user.toLowerCase()}:${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
