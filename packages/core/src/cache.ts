import { QUOTE_BUCKETS_USDT } from "@tally/config";

/** TTL cache that also shares one in-flight load between concurrent callers. Clock is injectable for tests. */
export class TtlCache<V> {
  private readonly values = new Map<string, { value: V; expires: number }>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.values.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = load()
      .then((value) => {
        this.values.set(key, { value, expires: this.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  clear(): void {
    this.values.clear();
  }
}

/** Quotes are cached per (ticker, amount bucket) (blueprint §7.7): 6, 10, 25, 50, 100, 250, 500, 1000 USDT, else the exact amount. */
export function amountBucket(usd: number): string {
  const hit = (QUOTE_BUCKETS_USDT as readonly number[]).find((b) => b === usd);
  return hit !== undefined ? String(hit) : `x${usd}`;
}
