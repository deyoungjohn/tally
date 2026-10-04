import {
  ALL_RULES,
  buildTokenStateFromSnapshots,
  deduplicateAlerts,
  DEFAULT_GUARDIAN_SETTINGS,
  deliverPendingAlerts,
  evaluateHoldingRules,
  MAX_STORED_ALERTS_PER_WALLET,
  type Alert,
  type FlowAggregateSubset,
  type FlowGhostSnapshotSubset,
  type GuardianSettings,
  type Issuer,
  type RadarSnapshotSubset,
  type TelegramDeliverySender,
  type TokenState,
  type TokenStatusState,
  type UserHolding,
} from "@tally/mod-guardian";
import type { WorkerJob } from "../runner";

interface RegistryItem {
  underlyingTicker?: string;
  tokenContractAddress?: string;
  issuer?: Issuer | null;
  decimals?: number;
  symbol?: string;
}

interface PortfolioSnapshotData {
  holdings?: Array<{
    tokenContractAddress: string;
    ticker: string;
    issuer?: Issuer | null;
    balanceTokens: bigint;
    balanceShares?: bigint | null;
    sharesUnavailableReason?: string;
    isRecognized?: boolean;
  }>;
}

/**
 * Worker job for WO-06 Guardian alerts:
 * Evaluates holdings of subscribed users once per minute from snapshots.
 * Writes generated alerts to the SnapshotStore under kind "alerts" (wallet-keyed),
 * ensuring prune protection and strict per-wallet isolation.
 * Dispatches pending alerts to linked Telegram chats using unified deliverPendingAlerts.
 */
export const job: WorkerJob = {
  name: "guardian",
  intervalMs: 60_000, // 1 minute
  async run(ctx) {
    // 1. Feature flag gate (Finding 11)
    if (process.env.FEATURE_GUARDIAN !== "1") {
      return;
    }

    const now = ctx.now();

    // 2. Discover target wallets from wallet:active (Finding 4)
    const activeWalletSnaps = ctx.store.history<{ address?: string }>(
      "wallet:active",
      "bsc",
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const discoveredAddresses = activeWalletSnaps
      .map((s) => s.data?.address?.toLowerCase())
      .filter((addr): addr is string => typeof addr === "string" && addr.startsWith("0x"));

    const envWallet = process.env.TALLY_TEST_WALLET;
    const allowTestWallet = envWallet && process.env.NODE_ENV !== "production";

    const targetWallets = Array.from(
      new Set([
        ...(allowTestWallet && envWallet ? [envWallet.toLowerCase()] : []),
        ...discoveredAddresses,
      ]),
    );

    if (targetWallets.length === 0) {
      ctx.health.report("guardian", { ok: true, now });
      return;
    }

    // 3. Read registry & radar snapshots
    const regSnap = ctx.store.latest<RegistryItem[]>("registry", "bsc", {
      maxAgeMs: 600_000,
      now,
    });
    const registryItems: RegistryItem[] = Array.isArray(regSnap?.data) ? regSnap.data : [];
    const registryByAddress = new Map<string, RegistryItem>();
    for (const item of registryItems) {
      if (item.tokenContractAddress) {
        registryByAddress.set(item.tokenContractAddress.toLowerCase(), item);
      }
    }

    const radarSnap = ctx.store.latest<{ rows?: RadarSnapshotSubset[] }>("radar", "bsc", {
      maxAgeMs: 600_000,
      now,
    });
    const radarRows: RadarSnapshotSubset[] = radarSnap?.data?.rows ?? [];

    // 4. Collect holdings for all target wallets (Finding 5: read snapshot holdings only, no floats)
    const holdingsByWallet = new Map<string, UserHolding[]>();
    const allUniqueTokenAddresses = new Set<string>();

    for (const wallet of targetWallets) {
      const portSnap =
        ctx.store.latest<PortfolioSnapshotData>("portfolio", wallet, {
          maxAgeMs: 86_400_000,
          now,
        }) ??
        ctx.store.latest<PortfolioSnapshotData>("statement", wallet, {
          maxAgeMs: 86_400_000,
          now,
        });

      const rawHoldings = portSnap?.data?.holdings ?? [];
      const walletHoldings: UserHolding[] = [];

      for (const item of rawHoldings) {
        if (!item.tokenContractAddress || item.balanceTokens <= 0n || item.isRecognized === false) {
          continue;
        }

        const tokenAddr = item.tokenContractAddress.toLowerCase();
        const regItem = registryByAddress.get(tokenAddr);
        const issuer = item.issuer ?? regItem?.issuer ?? null;

        if (!issuer) {
          ctx.onWarn(`Skipping holding for ${item.ticker} (${tokenAddr}): unknown issuer`);
          continue;
        }

        if (item.balanceShares == null) {
          ctx.onWarn(
            `Shares unavailable for ${item.ticker} (${tokenAddr}): ${item.sharesUnavailableReason ?? "multiplier unknown"}`,
          );
          continue; // Skip holding for share-based rules
        }

        walletHoldings.push({
          walletAddress: wallet,
          tokenAddress: tokenAddr,
          ticker: item.ticker,
          issuer,
          tokens: item.balanceTokens,
          shares: item.balanceShares,
        });
        allUniqueTokenAddresses.add(tokenAddr);
      }

      if (walletHoldings.length > 0) {
        holdingsByWallet.set(wallet, walletHoldings);
      }
    }

    // 5. Build token states once for all tokens across this run (Finding 3, Finding 6)
    const prevStatesByToken = new Map<string, TokenState | null>();
    const nextStatesByToken = new Map<string, TokenState>();
    let warnedPauseThisRun = false;

    for (const tokenAddr of allUniqueTokenAddresses) {
      const prevStateSnap = ctx.store.latest<TokenState>("guardian-state", tokenAddr, {
        maxAgeMs: 86_400_000,
        now,
      });
      prevStatesByToken.set(tokenAddr, prevStateSnap?.data ?? null);

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

      const radarRow = radarRows.find((r) => r.address && r.address.toLowerCase() === tokenAddr);
      const regItem = registryByAddress.get(tokenAddr);

      // Finding 6: bStock pause read is not yet active onchain; unknown stays null, warn once per run
      let isPausedOnchain: boolean | null = null;
      if (regItem?.issuer === "bstock") {
        isPausedOnchain = null;
        if (!warnedPauseThisRun) {
          ctx.onWarn(
            "bStock on-chain pause check is not active (no chain.isPaused port configured)",
          );
          warnedPauseThisRun = true;
        }
      }

      const nextState = buildTokenStateFromSnapshots({
        tokenAddress: tokenAddr,
        ticker: regItem?.underlyingTicker ?? radarRow?.ticker ?? "UNKNOWN",
        issuer: regItem?.issuer ?? "bstock",
        observedAt: now,
        rawStatus: statusSnap?.data,
        rawMultiplier: multSnap?.data?.value ? BigInt(multSnap.data.value) : undefined,
        rawRadar: radarRow,
        rawFlowGhost: ghostSnap?.data,
        rawFlowAggregate: flowSnap?.data,
        isFlowGhostStale: ghostSnap?.stale ?? false,
        sharePriceUsd: priceSnap?.data?.tokenPrice ? Number(priceSnap.data.tokenPrice) : undefined,
        isPausedOnchain,
        onWarn: ctx.onWarn,
      });

      nextStatesByToken.set(tokenAddr, nextState);
    }

    // 6. Evaluate holding rules per wallet against consistent run snapshot (Finding 3)
    const deliveryErrors: string[] = [];
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

    const sender: TelegramDeliverySender = {
      async sendMessage(chatId, text) {
        if (!telegramToken) {
          throw new Error("Missing TELEGRAM_BOT_TOKEN");
        }
        const res = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        if (!res.ok) {
          throw new Error(`Telegram API responded with ${res.status}: ${await res.text()}`);
        }
      },
    };

    for (const [wallet, holdings] of holdingsByWallet.entries()) {
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
        const prevState = prevStatesByToken.get(tokenAddr) ?? null;
        const nextState = nextStatesByToken.get(tokenAddr);
        if (!nextState) continue;

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
      }

      // Deduplicate new alerts against existing history
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

      // Combine and cap alert list (Finding 12)
      let combinedAlerts = [...alertHistory, ...newAlerts];
      if (combinedAlerts.length > MAX_STORED_ALERTS_PER_WALLET) {
        combinedAlerts = combinedAlerts.slice(-MAX_STORED_ALERTS_PER_WALLET);
      }

      // Deliver undelivered alerts via unified delivery function (Finding 7)
      if (combinedAlerts.length > 0) {
        const deliveryResult = await deliverPendingAlerts(
          sender,
          combinedAlerts,
          ctx.store,
          now,
          ctx.onWarn,
        );

        if (deliveryResult.errors.length > 0) {
          deliveryErrors.push(...deliveryResult.errors);
        }

        // Persist updated alerts with delivery tracking (deliveredAt, attempts)
        ctx.store.put({
          kind: "alerts",
          key: wallet,
          data: deliveryResult.updatedAlerts,
          source: "guardian",
          observedAt: now,
        });
      }
    }

    // 7. Persist updated token states AFTER all wallets are evaluated (Finding 3)
    for (const [tokenAddr, nextState] of nextStatesByToken.entries()) {
      ctx.store.put({
        kind: "guardian-state",
        key: tokenAddr,
        data: nextState,
        source: "guardian",
        observedAt: now,
      });
    }

    // 8. Report health (Finding 7: report error in health if delivery failed)
    if (deliveryErrors.length > 0) {
      ctx.health.report("guardian", {
        ok: false,
        error: `Telegram delivery failed: ${deliveryErrors.slice(0, 3).join("; ")}`,
        now,
      });
    } else {
      ctx.health.report("guardian", { ok: true, now });
    }
  },
};
