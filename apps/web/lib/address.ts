import { isAddress } from "viem";
import { SHAREGUARD_DEPLOYED, USDT_BSC } from "@tally/config";

export type AddressCheck = { ok: true; address: `0x${string}` } | { ok: false; problem: string };

/** Addresses nobody can recover funds from, or that are Tally's or the token's own contracts (money sent there is stuck). */
const BLOCKED: Record<string, string> = {
  "0x0000000000000000000000000000000000000000":
    "That's the zero address. Anything sent there is lost.",
  "0x000000000000000000000000000000000000dead":
    "That's a burn address. Anything sent there is lost.",
  [USDT_BSC.toLowerCase()]: "That's the USDT contract, not a wallet. Anything sent there is lost.",
  [SHAREGUARD_DEPLOYED.toLowerCase()]:
    "That's a Tally contract, not a wallet. Anything sent there is stuck.",
};

/** Zero-width and bidi-control characters that survive a copy-paste and make a lookalike address. */
const HIDDEN = new RegExp("[\\u200b-\\u200f\\u2060\\ufeff\\u202a-\\u202e]");

/**
 * Validates a recipient for the Send form. Every rule gives its own plain message so the person knows what to fix.
 * Sending to your own address is allowed on purpose: it is the first thing most people try, to see that sending works.
 * Mixed-case addresses must carry a correct checksum (a mistyped letter is caught); all-lowercase is accepted.
 */
export function checkRecipient(raw: string): AddressCheck {
  const v = raw.trim();
  if (v === "") return { ok: false, problem: "Enter a wallet address." };
  if (/\s/.test(v) || HIDDEN.test(v))
    return { ok: false, problem: "The address has spaces or hidden characters." };
  if (!/^0x/i.test(v)) return { ok: false, problem: "A wallet address starts with 0x." };
  if (!/^0x[0-9a-fA-F]*$/.test(v))
    return { ok: false, problem: "Only the digits 0-9 and letters a-f are allowed after 0x." };
  if (v.length !== 42)
    return {
      ok: false,
      problem: `A wallet address has 42 characters, this one has ${v.length}.`,
    };
  if (!isAddress(v, { strict: true }))
    return {
      ok: false,
      problem: "The capital letters don't match, so a character is probably mistyped.",
    };
  const lower = v.toLowerCase();
  const blocked = BLOCKED[lower];
  if (blocked) return { ok: false, problem: blocked };
  return { ok: true, address: v as `0x${string}` };
}
