/**
 * Seeds data/ondo-multiplier-baseline.json from the 2026-09-30 public snapshot (research/snapshot-2026-09-30).
 * Run once: pnpm --filter @tally/engine exec tsx scripts/seed-ondo-baseline.ts
 * `seenAt` is when the snapshot was taken (meta.json), the honest observation time; the list's own `lastUpdateTime`
 * (when Ondo last changed the value) is not used. Only BSC (chain 56) tokens with a positive multiplier are seeded.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDecimal } from "@tally/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const snap = join(root, "research", "snapshot-2026-09-30");
const list = JSON.parse(readFileSync(join(snap, "rwa_list_ondo.json"), "utf8")).data as Array<{
  chainId: string;
  contractAddress: string;
  symbol: string;
  multiplier?: string | null;
}>;
const meta = JSON.parse(readFileSync(join(snap, "meta.json"), "utf8")) as {
  fetched_at_utc: string;
};

const entries: Record<string, { symbol: string; value: string; seenAt: string }> = {};
for (const r of list) {
  if (r.chainId !== "56" || !r.multiplier) continue;
  if (parseDecimal(r.multiplier, 18) <= 0n) continue;
  entries[r.contractAddress.toLowerCase()] = {
    symbol: r.symbol,
    value: r.multiplier,
    seenAt: meta.fetched_at_utc,
  };
}
const out = {
  schema: 1,
  source: `research/snapshot-2026-09-30/rwa_list_ondo.json (public Ondo list, chain 56), fetched ${meta.fetched_at_utc}`,
  entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))),
};
const path = join(root, "data", "ondo-multiplier-baseline.json");
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`seeded ${Object.keys(out.entries).length} Ondo tokens → ${path}`);
