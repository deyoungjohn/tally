import {
  POLICY_MAX_AGE_MS,
  REGISTRY_MAX_AGE_MS,
  positionKey,
  positionShares,
  readDecisionLog,
  referenceUsdPerShare,
  registryToken,
  runShadow,
  type Alert,
  type PolicySettings,
  type Position,
  type RegistryEntry,
} from "@tally/mod-autopilot";
import type { Snapshot } from "@tally/modkit";
import type { WorkerContext, WorkerJob } from "../runner";

type Address = `0x${string}`;
type PauseStart = { pausedSince: number | null };

/** Stop awaiting promptly on cancellation; an engine read cannot commit late results. */
async function cancellable<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return read();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error("Autopilot collection aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return read();
      }),
      cancelled,
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Bounded opt-in collector inside the existing job; only read-only engine capabilities. */
export async function collectAutopilotPositions(ctx: WorkerContext): Promise<void> {
  ctx.signal?.throwIfAborted();
  const now = ctx.now();
  const decided = new Set(readDecisionLog(ctx.store).map((row) => row.alertId));
  const feeds = ctx.store.listLatest<Alert[]>("alerts", { maxAgeMs: 60_000, now, limit: 1000 });
  // Match the shadow adapter's capacity/validation checks before doing any engine work.
  if (feeds.length === 1000) {
    ctx.onWarn("Autopilot collection failed: alert feed capacity reached");
    throw new Error("Alert feed capacity reached");
  }
  const pendingWallets = new Set<string>();
  for (const feed of feeds) {
    if (!Array.isArray(feed.data)) throw new Error("Invalid alerts snapshot");
    for (const alert of feed.data) {
      if (alert.walletAddress.toLowerCase() !== feed.key.toLowerCase())
        throw new Error("Alert wallet does not match feed");
      if (!decided.has(alert.id)) pendingWallets.add(feed.key.toLowerCase());
    }
  }
  const optedIn: Snapshot<PolicySettings>[] = [];
  for (const wallet of pendingWallets) {
    const policy = ctx.store.latest<PolicySettings>("autopilot-policy", wallet, {
      maxAgeMs: POLICY_MAX_AGE_MS,
      now,
    });
    if (!policy) continue;
    if (policy.stale) {
      ctx.onWarn("Autopilot stale policy skipped by position collector");
      continue;
    }
    if (optedIn.length === 20) {
      ctx.onWarn("Autopilot wallets truncated to 20 per run");
      break;
    }
    optedIn.push(policy);
  }
  if (!optedIn.length) return;
  const registry = ctx.store.latest<RegistryEntry[]>("registry", "bsc", {
    maxAgeMs: REGISTRY_MAX_AGE_MS,
    now,
  });
  if (!registry || registry.stale || !Array.isArray(registry.data)) {
    ctx.onWarn("Autopilot collection failed: registry missing or stale; decision log unchanged");
    throw new Error("Autopilot registry missing or stale");
  }
  const prices = ctx.store.latest<
    Array<{ tokenContractAddress: string; referencePrice?: string | null }>
  >("prices", "bsc", { maxAgeMs: 60_000, now });
  const staged: Snapshot<unknown>[] = [];
  // Cache failures too: an unavailable ticker must not trigger a retry per wallet/token.
  const factsCache = new Map<string, ReturnType<WorkerContext["engine"]["facts"]>>();
  const pauseCache = new Map<string, { paused: boolean | null; pausedSince: number | null }>();
  let attempted = 0;
  let collected = 0;
  for (const policy of optedIn) {
    ctx.signal?.throwIfAborted();
    const wallet = policy.key.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet) || !Array.isArray(policy.data.tokenAllowList))
      throw new Error("Invalid Autopilot policy snapshot");
    if (policy.data.tokenAllowList.length > 10)
      ctx.onWarn("Autopilot tokens truncated to 10 per wallet");
    const keys: string[] = [];
    const sharesCache = new Map<
      string,
      { observedAt: number; report: ReturnType<WorkerContext["engine"]["sharesOf"]> }
    >();
    for (const address of [
      ...new Set(policy.data.tokenAllowList.map((t) => t.toLowerCase())),
    ].slice(0, 10)) {
      ctx.signal?.throwIfAborted();
      attempted++;
      const row = registry.data.find((r) => r.tokenContractAddress.toLowerCase() === address);
      const token = row ? registryToken(row) : null;
      if (!token?.executable || !row) {
        ctx.onWarn("Autopilot token skipped: not an executable registry token");
        continue;
      }
      // Engine handles the accepted multiplier and chain balance; never share balances across wallets.
      let shareRead = sharesCache.get(token.ticker);
      if (!shareRead) {
        shareRead = {
          observedAt: ctx.now(),
          report: cancellable(
            () => ctx.engine.sharesOf(wallet as Address, [token.ticker]),
            ctx.signal,
          ),
        };
        sharesCache.set(token.ticker, shareRead);
      }
      const observedAt = shareRead.observedAt;
      let holding;
      try {
        const report = await shareRead.report;
        holding = report.rows.find((r) => r.address.toLowerCase() === address);
        if (!holding || holding.issuer !== token.issuer || holding.ticker !== token.ticker)
          throw new Error("Share holding missing or mismatched");
      } catch {
        ctx.signal?.throwIfAborted();
        ctx.onWarn("Autopilot token collection failed; token skipped, details withheld");
        continue;
      }
      const warnings: string[] = [];
      const warn = (reason: string) => {
        warnings.push(reason);
        ctx.onWarn(`Autopilot: ${reason}`);
      };
      const decimals = holding.decimals === 18 ? 18 : null;
      if (decimals === null) warn("unknown token decimals");
      const balance =
        typeof holding.balance === "bigint" && holding.balance >= 0n ? holding.balance : null;
      if (balance === null) warn("chain balance unavailable");
      const multiplier =
        typeof holding.multiplier === "bigint" && holding.multiplier > 0n
          ? holding.multiplier
          : null;
      if (multiplier === null) warn("unknown multiplier; shares unavailable");
      if (holding.degraded) warn("Accepted multiplier uses a degraded engine source");
      const shares = positionShares(balance, multiplier, decimals);
      let grade: Position["grade"] = null;
      try {
        let reading = factsCache.get(token.ticker);
        if (!reading) {
          reading = cancellable(() => ctx.engine.facts(token.ticker), ctx.signal);
          factsCache.set(token.ticker, reading);
        }
        const facts = await reading;
        const fact = facts.find((f) => f.address.toLowerCase() === address);
        grade = fact?.integrity.grade ?? null;
      } catch {
        ctx.signal?.throwIfAborted();
        warn("grade unknown; engine facts unavailable");
      }
      if (grade === null && !warnings.some((w) => w.startsWith("grade unknown")))
        warn("grade unknown");
      const priceRow = !prices?.stale
        ? prices?.data.find((p) => p.tokenContractAddress.toLowerCase() === address)
        : undefined;
      let usdPerShare = referenceUsdPerShare(priceRow?.referencePrice, row.tokenToShareRatio);
      if (usdPerShare === null) {
        usdPerShare = referenceUsdPerShare(row.referencePrice, row.tokenToShareRatio);
        if (usdPerShare !== null)
          warn("Price snapshot reference unavailable; using registry reference");
      }
      if (usdPerShare === null)
        warn("unknown share price; reference price or recorded ratio unavailable");
      let pause = pauseCache.get(address);
      if (!pause) {
        let paused: boolean | null = null;
        try {
          const reading = await cancellable(() => ctx.engine.pauseState(token.address), ctx.signal);
          paused = reading.paused;
        } catch {
          ctx.signal?.throwIfAborted();
          warn("pause unknown; engine pause read unavailable");
        }
        const previous = ctx.store.latest<PauseStart>("autopilot-pause", address, {
          maxAgeMs: Number.MAX_SAFE_INTEGER,
          now,
        });
        const old = previous?.data.pausedSince ?? null;
        const pausedSince = paused === true ? (old ?? now) : paused === false ? null : old;
        if (paused !== null && (!previous || pausedSince !== old))
          staged.push({
            kind: "autopilot-pause",
            key: address,
            data: { pausedSince },
            source: "autopilot:collector",
            observedAt: now,
          });
        pause = { paused, pausedSince };
        pauseCache.set(address, pause);
      }
      if (pause.paused === null)
        warn("pause duration unknown; unknown reading preserves continuous pause start");
      const position: Position & { warnings: string[] } = {
        walletAddress: wallet,
        tokenAddress: address,
        ticker: token.ticker,
        issuer: token.issuer,
        chainBalanceTokens: balance,
        balanceSource: "chain",
        tokenDecimals: decimals,
        shares,
        multiplier,
        usdPerShare,
        grade,
        ...pause,
        observedAt,
        warnings,
      };
      const key = positionKey(wallet, address);
      staged.push({
        kind: "autopilot-position",
        key,
        data: position,
        source: "autopilot:collector",
        observedAt,
        notes: warnings,
      });
      keys.push(key);
      collected++;
    }
    staged.push({
      kind: "autopilot-collector",
      key: wallet,
      data: { positionKeys: keys },
      source: "autopilot:collector",
      observedAt: ctx.now(),
    });
  }
  if (attempted > 0 && collected === 0) {
    ctx.onWarn("Autopilot collection failed for every token; decision log unchanged");
    throw new Error("Autopilot collection failed for every token");
  }
  ctx.signal?.throwIfAborted();
  for (const snapshot of staged) {
    ctx.signal?.throwIfAborted();
    ctx.store.put(snapshot);
  }
}

export const job: WorkerJob = {
  name: "autopilot",
  intervalMs: 60_000,
  timeoutMs: 30_000,
  async run(ctx) {
    if (process.env.FEATURE_AUTOPILOT !== "1") return;
    await collectAutopilotPositions(ctx);
    runShadow(ctx);
  },
};
