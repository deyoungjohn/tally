import { TtlCache } from "@tally/core";
import { FLOW_MAX_AGE_MS, RADAR_MAX_AGE_MS } from "@tally/mod-flow";
import { loadRadar, type RadarFilters, type RadarVM } from "./view-model";

type Options = Parameters<typeof loadRadar>[0];
interface Entry {
  vm: RadarVM;
  loadedAt: number;
  validUntil: number;
}
class Unavailable extends Error {
  constructor(readonly vm: RadarVM) {
    super("Radar snapshot load unavailable");
  }
}
function key(filters: RadarFilters = {}, flowEnabled = false): string {
  return JSON.stringify([
    flowEnabled,
    filters.issuer ?? null,
    filters.grade ?? null,
    filters.ghost ?? null,
  ]);
}
function validUntil(vm: RadarVM, now: number): number {
  const remaining = vm.cards.flatMap((card) => [
    ...card.grades.filter((g) => !g.stale).map((g) => RADAR_MAX_AGE_MS - g.ageMs + 1),
    ...(card.flowPanel?.issuers.filter((i) => !i.stale).map((i) => FLOW_MAX_AGE_MS - i.ageMs + 1) ??
      []),
  ]);
  return now + Math.min(20_000, ...remaining);
}
function age(vm: RadarVM, elapsed: number): RadarVM {
  if (elapsed === 0) return vm;
  const cards = vm.cards.map((card) => ({
    ...card,
    grades: card.grades.map((g) => ({ ...g, ageMs: g.ageMs + elapsed })),
    flowPanel: card.flowPanel
      ? {
          ...card.flowPanel,
          ageMs: card.flowPanel.ageMs === null ? null : card.flowPanel.ageMs + elapsed,
          issuers: card.flowPanel.issuers.map((i) => ({
            ...i,
            ageMs: i.ageMs + elapsed,
            lastRealTradeAgeMs:
              i.lastRealTradeAgeMs === null ? null : i.lastRealTradeAgeMs + elapsed,
          })),
        }
      : null,
  }));
  return { ...vm, cards, ageMs: vm.ageMs === null ? null : vm.ageMs + elapsed };
}

/** Public Radar data only. One 20s cache per web process; rejected loads never enter TtlCache. */
export function createRadarCache(load: typeof loadRadar = loadRadar, now: () => number = Date.now) {
  const cache = new TtlCache<Entry>(20_000, now);
  return async (options: Options = {}): Promise<RadarVM> => {
    const cacheKey = key(options.filters, options.flowEnabled ?? process.env.FEATURE_FLOW === "1");
    const compute = async () => {
      const loadedAt = options.now ?? now();
      const vm = await load({ ...options, now: loadedAt });
      if (vm.state === "error") throw new Unavailable(vm);
      return { vm, loadedAt, validUntil: validUntil(vm, loadedAt) };
    };
    try {
      let entry = await cache.get(cacheKey, compute);
      if (entry.validUntil <= (options.now ?? now())) {
        // Cross a snapshot staleness boundary immediately, even within the 20s TTL.
        cache.clear();
        entry = await cache.get(cacheKey, compute);
      }
      return age(entry.vm, Math.max(0, (options.now ?? now()) - entry.loadedAt));
    } catch (error) {
      // Preserve the loader's public error state while keeping failures retryable.
      if (error instanceof Unavailable) return error.vm;
      throw error;
    }
  };
}
