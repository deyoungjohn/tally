import type { NextRequest } from "next/server";
import { z } from "zod";
import { INCOMING_MAX_BLOCKS } from "@tally/chain";
import { getEngine } from "@/lib/server/engine";
import { errorResponse, json, rateLimited, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const query = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** History reaches back 90 days at most (about 3 s a block). */
const WINDOW_BLOCKS = 2_592_000n;
const MAX_TOKENS = 12;
const CACHE_MS = 120_000;
const cache = new Map<string, { at: number; body: unknown }>();

export interface ReceivedTransfer {
  token: string;
  from: string;
  /** Tokens (not shares), decimal string. */
  tokens: string;
  date: string;
  txHash: string;
}

/**
 * Dated incoming transfers of the tokenized stocks a wallet holds, last 90 days. Public chain data, read-only.
 * Only registry token addresses (taken from the wallet's own holdings) are ever read, never addresses from the request.
 */
export async function GET(req: NextRequest) {
  if (rateLimited(req, "transfers", 10)) return tooMany();
  try {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    const address = q.address as `0x${string}`;
    const hit = cache.get(address.toLowerCase());
    if (hit && Date.now() - hit.at < CACHE_MS) return json(hit.body);
    const engine = await getEngine();
    const held = await engine.holdings(address);
    const tokens = held.tokens.slice(0, MAX_TOKENS);
    // No block number (provider down, or no recording in fixture mode): every token is reported incomplete, the page keeps undated rows.
    const latest = await engine.chain.blockNumber().catch(() => null);
    if (latest === null)
      return json({
        address,
        days: 90,
        transfers: [],
        incomplete: tokens.map((t) => t.address),
      });
    const span = WINDOW_BLOCKS < INCOMING_MAX_BLOCKS ? WINDOW_BLOCKS : INCOMING_MAX_BLOCKS;
    const from = latest >= span ? latest - span + 1n : 0n;
    const results = await Promise.all(
      tokens.map(async (t) => {
        try {
          const r = await engine.chain.incomingTransfers(t.address, address, from, latest);
          return { t, r, ok: true as const };
        } catch {
          return { t, r: null, ok: false as const };
        }
      }),
    );
    const transfers: ReceivedTransfer[] = [];
    for (const { t, r } of results) {
      for (const x of r?.transfers ?? []) {
        transfers.push({
          token: t.address,
          from: x.from,
          tokens: (Number(x.amount) / 10 ** t.decimals).toString(),
          date: new Date(x.timestampMs).toISOString(),
          txHash: x.transactionHash,
        });
      }
    }
    transfers.sort((a, b) => (a.date < b.date ? 1 : -1));
    const body = {
      address,
      days: 90,
      transfers,
      // Tokens whose scan failed or stopped early: the page falls back to an undated "Received" row for them.
      incomplete: results.filter((x) => !x.ok || !x.r?.complete).map((x) => x.t.address),
    };
    cache.set(address.toLowerCase(), { at: Date.now(), body });
    return json(body);
  } catch (e) {
    return errorResponse(e);
  }
}
