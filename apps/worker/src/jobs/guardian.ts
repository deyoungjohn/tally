import {
  ALL_RULES,
  buildTokenStateFromSnapshots,
  deduplicateAlerts,
  DEFAULT_GUARDIAN_SETTINGS,
  evaluateHoldingRules,
  getLinkedChatForWallet,
  isQuietHours,
  nextQuietEnd,
  type Alert,
  type FlowAggregateSubset,
  type FlowGhostSnapshotSubset,
  type GuardianSettings,
  type Issuer,
  type RadarSnapshotSubset,
  type TokenState,
  type TokenStatusState,
  type UserHolding,
} from "@tally/mod-guardian";
import type { WorkerJob } from "../runner";

/**
 * Worker job for WO-06 Guardian alerts:
 * Evaluates holdings of subscribed users once per minute from snapshots.
 * Writes generated alerts to the SnapshotStore under kind "alerts" (wallet-keyed),
 * ensuring prune protection and strict per-wallet isolation.
 * Dispatches pending alerts to linked Telegram chats if TELEGRAM_BOT_TOKEN is set.
 */
export const job: WorkerJob = {
  name: "guardian",
  intervalMs: 60_000, // 1 minute
  async run(ctx) {
    const now = ctx.now();

    // 1. Discover target wallets
    const activeWalletSnaps = ctx.store.history<{ address: string }>("wallet:active", "bsc", 0, 50);
    const discoveredAddresses = activeWalletSnaps
      .map((s) => s.data?.address)
      .filter((addr): addr is string => typeof addr === "string" && addr.startsWith("0x"));

    const envWallet = process.env.TALLY_TEST_WALLET;
    const allowTestWallet = envWallet && process.env.NODE_ENV !== "production";

    // Also look up any wallets with active link records
    const linkedCodes = ctx.store.history<{ walletAddress: string }>(
      "guardian-link-code",
      "",
      0,
      50,
    );
    const linkedAddresses = linkedCodes
      .map((s) => s.data?.walletAddress)
      .filter((addr): addr is string => typeof addr === "string" && addr.startsWith("0x"));

    const targetWallets = [
      ...new Set([
        ...(allowTestWallet && envWallet ? [envWallet.toLowerCase()] : []),
        ...discoveredAddresses.map((a) => a.toLowerCase()),
        ...linkedAddresses.map((a) => a.toLowerCase()),
      ]),
    ];

    if (targetWallets.length === 0) {
      ctx.health.report("guardian", { ok: true, now });
      return;
    }

    // 2. Discover available tickers & registry
    let knownTickers = ["NVDA", "AAPL", "TSLA", "QQQ", "SPY", "NFLX"];
    const regSnap = ctx.store.latest<Array<{ underlyingTicker?: string }>>("registry", "bsc", {
      maxAgeMs: 600_000,
      now,
    });
    if (regSnap?.data && Array.isArray(regSnap.data)) {
      const set = new Set<string>();
      for (const r of regSnap.data) {
        if (r.underlyingTicker) set.add(r.underlyingTicker.toUpperCase());
      }
      if (set.size > 0) knownTickers = Array.from(set);
    }

    // Read radar snapshot for integrity grades and ghost checks
    const radarSnap = ctx.store.latest<{ rows?: RadarSnapshotSubset[] }>("radar", "bsc", {
      maxAgeMs: 600_000,
      now,
    });
    const radarRows: RadarSnapshotSubset[] = radarSnap?.data?.rows ?? [];

    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

    for (const wallet of targetWallets) {
      // 3. Obtain user holdings
      const holdings: UserHolding[] = [];

      // Try reading latest statement or portfolio snapshot first
      const stmtSnap = ctx.store.latest<{
        lines?: Array<{
          tokenContractAddress?: string;
          amountTokens?: unknown;
          ticker: string;
          issuer?: string;
          rawTokens?: string;
          rawShares?: string;
        }>;
      }>("statement", wallet, { maxAgeMs: 600_000, now });
      if (stmtSnap?.data?.lines && Array.isArray(stmtSnap.data.lines)) {
        for (const line of stmtSnap.data.lines) {
          if (line.tokenContractAddress && line.amountTokens) {
            holdings.push({
              walletAddress: wallet,
              tokenAddress: line.tokenContractAddress.toLowerCase(),
              ticker: line.ticker,
              issuer: (line.issuer ?? "bstock").toLowerCase() as Issuer,
              tokens: BigInt(line.rawTokens ?? "0"),
              shares: BigInt(line.rawShares ?? "0"),
            });
          }
        }
      }

      // If no holdings in snapshot, query engine portfolio
      if (holdings.length === 0) {
        try {
          const report = await ctx.engine.portfolio(wallet as `0x${string}`, knownTickers);
          for (const group of report.groups) {
            for (const part of group.parts) {
              holdings.push({
                walletAddress: wallet,
                tokenAddress: part.address.toLowerCase(),
                ticker: part.ticker,
                issuer: part.issuer,
                tokens: BigInt(Math.round(part.tokens * 1e18)),
                shares: BigInt(Math.round(part.shares * 1e18)),
              });
            }
          }
        } catch (err) {
          ctx.onWarn(`Failed to query portfolio for wallet ${wallet}: ${err}`);
        }
      }

      if (holdings.length === 0) {
        continue;
      }

      // Read user Guardian settings
      const settingsSnap = ctx.store.latest<GuardianSettings>("guardian-settings", wallet, {
        maxAgeMs: 365 * 86_400_000,
        now,
      });
      const settings: GuardianSettings = settingsSnap?.data ?? DEFAULT_GUARDIAN_SETTINGS;
      if (!settings.enabled) {
        continue;
      }

      const walletGeneratedAlerts: Alert[] = [];

      for (const holding of holdings) {
        const tokenAddr = holding.tokenAddress.toLowerCase();

        // Query token snapshot facts
        const statusSnap = ctx.store.latest<TokenStatusState>("status", tokenAddr, {
          maxAgeMs: 120_000,
          now,
        });
        const multSnap = ctx.store.latest<{ value?: string | bigint }>("multiplier", tokenAddr, {
          maxAgeMs: 300_000,
          now,
        });
        const ghostSnap = ctx.store.latest<FlowGhostSnapshotSubset>("flow-ghost", tokenAddr, {
          maxAgeMs: 300_000,
          now,
        });
        const flowSnap = ctx.store.latest<FlowAggregateSubset>("flow-aggregate", tokenAddr, {
          maxAgeMs: 300_000,
          now,
        });
        const priceSnap = ctx.store.latest<{ tokenPrice?: string | number }>("price", tokenAddr, {
          maxAgeMs: 60_000,
          now,
        });

        // Find radar row
        const radarRow = radarRows.find((r) => r.address && r.address.toLowerCase() === tokenAddr);

        // Async bStock onchain pause resolution
        let isPausedOnchain: boolean | null = null;
        if (holding.issuer === "bstock") {
          try {
            const chainPort = ctx.engine.ports.chain as
              { isPaused?: (addr: string) => Promise<boolean> } | undefined;
            if (typeof chainPort?.isPaused === "function") {
              isPausedOnchain = await chainPort.isPaused(tokenAddr);
            } else {
              const onchainSnap = ctx.store.latest<boolean>("onchain-pause", tokenAddr, {
                maxAgeMs: 60_000,
                now,
              });
              isPausedOnchain = onchainSnap?.data ?? false;
            }
          } catch (err) {
            ctx.onWarn(`On-chain pause check failed for ${holding.ticker} (${tokenAddr}): ${err}`);
            isPausedOnchain = null;
          }
        }

        const nextState = buildTokenStateFromSnapshots({
          tokenAddress: tokenAddr,
          ticker: holding.ticker,
          issuer: holding.issuer,
          observedAt: now,
          rawStatus: statusSnap?.data,
          rawMultiplier: multSnap?.data?.value ? BigInt(multSnap.data.value) : undefined,
          rawRadar: radarRow,
          rawFlowGhost: ghostSnap?.data,
          rawFlowAggregate: flowSnap?.data,
          isFlowGhostStale: ghostSnap?.stale ?? false,
          sharePriceUsd: priceSnap?.data?.tokenPrice
            ? Number(priceSnap.data.tokenPrice)
            : undefined,
          isPausedOnchain,
          onWarn: ctx.onWarn,
        });

        // Read previous state
        const prevStateSnap = ctx.store.latest<TokenState>("guardian-state", tokenAddr, {
          maxAgeMs: 86_400_000,
          now,
        });
        const prevState = prevStateSnap?.data ?? null;

        // Evaluate holding rules
        const evaluatedAlerts = evaluateHoldingRules(
          ALL_RULES,
          prevState,
          nextState,
          holding,
          undefined,
          settings,
          ctx.onWarn,
        );

        walletGeneratedAlerts.push(...evaluatedAlerts);

        // Save current token state for next evaluation cycle
        ctx.store.put({
          kind: "guardian-state",
          key: tokenAddr,
          data: nextState,
          source: "guardian",
          observedAt: now,
        });
      }

      // 4. Deduplicate and record alerts
      const prevAlertsSnap = ctx.store.latest<Alert[]>("alerts", wallet, {
        maxAgeMs: 30 * 86_400_000,
        now,
      });
      const alertHistory: Alert[] = prevAlertsSnap?.data ?? [];

      const newAlerts = deduplicateAlerts(
        walletGeneratedAlerts,
        alertHistory,
        settings.cooldownMs ?? 86_400_000,
      );

      // Check quiet hours
      const inQuiet = isQuietHours(now, settings.quietHours);
      for (const alert of newAlerts) {
        if (inQuiet) {
          alert.deliverAt = nextQuietEnd(now, settings.quietHours);
        }
      }

      if (newAlerts.length > 0) {
        const updatedAlerts = [...alertHistory, ...newAlerts];
        ctx.store.put({
          kind: "alerts",
          key: wallet,
          data: updatedAlerts,
          source: "guardian",
          observedAt: now,
        });
      }

      // 5. Telegram delivery dispatch (if linked)
      const linkedChat = getLinkedChatForWallet(ctx.store, wallet, now);
      if (linkedChat && linkedChat.alertsEnabled && telegramToken) {
        // Pending alerts ready to deliver
        const pendingToDeliver = newAlerts.filter((a) => !a.deliverAt || now >= a.deliverAt);
        for (const alert of pendingToDeliver) {
          try {
            const icon =
              alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠️" : "ℹ️";
            const text = `${icon} *Guardian Alert: ${alert.title}*\n\n${alert.body}\n\n_Evidence: ${alert.evidence.snapshotKind} snapshot (${new Date(alert.evidence.observedAt).toISOString()})_`;
            const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: linkedChat.chatId, text, parse_mode: "Markdown" }),
            });
            if (!res.ok) {
              ctx.onWarn(`Telegram API responded with ${res.status}: ${await res.text()}`);
            }
          } catch (err) {
            ctx.onWarn(`Telegram delivery failed for wallet ${wallet}: ${err}`);
          }
        }
      }
    }

    ctx.health.report("guardian", { ok: true, now });
  },
};
