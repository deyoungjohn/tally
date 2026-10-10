import { E18, mulDiv, statusFromInfo, type RawStatusInfo } from "@tally/core";
import type { ModuleHealth, SnapshotStore } from "@tally/modkit";
import { deduplicateAlerts } from "./dedup";
import {
  deliverPendingAlerts,
  redactSecrets,
  type DeliverAlertsResult,
  type TelegramDeliverySender,
} from "./delivery";
import { buildTokenStateFromSnapshots, evaluateHoldingRules } from "./evaluator";
import { getLinkedChatForWallet } from "./link";
import { ALL_RULES } from "./rules";
import {
  DEFAULT_GUARDIAN_SETTINGS,
  MAX_STORED_ALERTS_PER_WALLET,
  type Alert,
  type FlowAggregateSubset,
  type FlowGhostSnapshotSubset,
  type GuardianSettings,
  type Issuer,
  type RadarSnapshotSubset,
  type TokenState,
  type UserHolding,
} from "./types";

export interface PortfolioSnapshotData {
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

export interface GuardianJobContext {
  store: SnapshotStore;
  health: ModuleHealth;
  now: () => number;
  onWarn: (msg: string) => void;
  sender?: TelegramDeliverySender;
  pauseState?: (
    tokenAddress: string,
  ) => Promise<{ paused: boolean | null; reason?: string | null; observedAt?: number }>;
  testWallet?: string;
  isProduction?: boolean;
}

export interface GuardianRunResult {
  evaluatedWallets: number;
  generatedAlerts: number;
  deliveredAlerts: number;
  deliveryErrors: string[];
}

/**
 * Checks whether alert array has changed (new alerts or updated delivery metadata).
 * Used to avoid rewriting the protected 'alerts' snapshot every minute when nothing changed.
 */
export function haveAlertsChanged(prev: Alert[], next: Alert[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) {
    const p = prev[i]!;
    const n = next[i]!;
    if (
      p.id !== n.id ||
      p.deliveredAt !== n.deliveredAt ||
      p.deliveryAttempts !== n.deliveryAttempts ||
      p.lastDeliveryError !== n.lastDeliveryError ||
      p.deliverAt !== n.deliverAt
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether business fields of TokenState changed (excluding observedAt timestamp).
 * Used to avoid rewriting 'guardian-state' snapshot every minute when token state is unchanged.
 */
export function hasTokenStateChanged(prev: TokenState | null, next: TokenState): boolean {
  if (!prev) return true;
  if (prev.ticker !== next.ticker) return true;
  if (prev.issuer !== next.issuer) return true;
  if (prev.status?.kind !== next.status?.kind) return true;
  if (prev.status?.reasonMsg !== next.status?.reasonMsg) return true;
  if (prev.status?.reasonCode !== next.status?.reasonCode) return true;
  if (prev.multiplier !== next.multiplier) return true;
  if (prev.grade !== next.grade) return true;
  if (prev.ghost !== next.ghost) return true;
  if (prev.lastRealTradeAgeDays !== next.lastRealTradeAgeDays) return true;
  if (prev.sharePriceUsd !== next.sharePriceUsd) return true;
  if (prev.session !== next.session) return true;
  if (prev.isPausedOnchain !== next.isPausedOnchain) return true;
  if (prev.gradeReasons.length !== next.gradeReasons.length) return true;
  for (let i = 0; i < next.gradeReasons.length; i++) {
    if (prev.gradeReasons[i] !== next.gradeReasons[i]) return true;
  }
  return false;
}

/**
 * Core evaluation run for the Guardian worker job.
 * Kept pure without direct network I/O; delivery sender is injected via GuardianJobContext.
 */
export async function runGuardianEvaluation(ctx: GuardianJobContext): Promise<GuardianRunResult> {
  const now = ctx.now();
  let generatedAlertsCount = 0;
  let deliveredAlertsCount = 0;

  // 1. Discover target wallets from wallet:active (Finding 4)
  const activeWalletSnaps = ctx.store.history<{ address?: string }>(
    "wallet:active",
    "bsc",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const discoveredAddresses = activeWalletSnaps
    .map((s) => s.data?.address?.toLowerCase())
    .filter((addr): addr is string => typeof addr === "string" && addr.startsWith("0x"));

  const envWallet = ctx.testWallet;
  const allowTestWallet = envWallet && !ctx.isProduction;

  const targetWallets = Array.from(
    new Set([
      ...(allowTestWallet && envWallet ? [envWallet.toLowerCase()] : []),
      ...discoveredAddresses,
    ]),
  );

  if (targetWallets.length === 0) {
    ctx.health.report("guardian", { ok: true, now });
    return {
      evaluatedWallets: 0,
      generatedAlerts: 0,
      deliveredAlerts: 0,
      deliveryErrors: [],
    };
  }

  // Warn once per run when linked chats exist but TELEGRAM_BOT_TOKEN / ctx.sender is not configured
  if (!ctx.sender) {
    let hasLinkedChat = false;
    for (const wallet of targetWallets) {
      const link = getLinkedChatForWallet(ctx.store, wallet, now);
      if (link && link.chatId) {
        hasLinkedChat = true;
        break;
      }
    }
    if (hasLinkedChat) {
      ctx.onWarn(
        "Linked Telegram chats exist, but TELEGRAM_BOT_TOKEN is not configured; alerts are stored, not delivered",
      );
    }
  }

  // 2. Collect holdings for all target wallets (Finding 5: snapshot holdings, bigint math)
  const holdingsByWallet = new Map<string, UserHolding[]>();
  const allUniqueTokenAddresses = new Set<string>();
  const issuerByToken = new Map<string, Issuer>();
  const tickerByToken = new Map<string, string>();
  const largestHoldingByToken = new Map<string, { tokens: bigint; shares: bigint }>();

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

      // Finding 2: Resolve issuer from holding or radar row, never default
      let issuer: Issuer | null =
        item.issuer === "ondo" || item.issuer === "bstock" || item.issuer === "xstocks"
          ? item.issuer
          : null;

      if (!issuer) {
        const radarSnap = ctx.store.latest<RadarSnapshotSubset>("radar", tokenAddr, {
          maxAgeMs: 7_200_000, // 2h
          now,
        });
        if (
          radarSnap?.data?.issuer === "ondo" ||
          radarSnap?.data?.issuer === "bstock" ||
          radarSnap?.data?.issuer === "xstocks"
        ) {
          issuer = radarSnap.data.issuer;
        }
      }

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

      // Track holding with largest token balance for candidate multiplier calculation (Finding 1)
      const existingLargest = largestHoldingByToken.get(tokenAddr);
      if (!existingLargest || item.balanceTokens > existingLargest.tokens) {
        largestHoldingByToken.set(tokenAddr, {
          tokens: item.balanceTokens,
          shares: item.balanceShares,
        });
      }

      // Re-review 2 Finding 6: Store holding.ticker to use on TokenState
      tickerByToken.set(tokenAddr, item.ticker);

      walletHoldings.push({
        walletAddress: wallet,
        tokenAddress: tokenAddr,
        ticker: item.ticker,
        issuer,
        tokens: item.balanceTokens,
        shares: item.balanceShares,
      });
      allUniqueTokenAddresses.add(tokenAddr);
      issuerByToken.set(tokenAddr, issuer);
    }

    if (walletHoldings.length > 0) {
      holdingsByWallet.set(wallet, walletHoldings);
    }
  }

  // 3. Build token states once for all tokens across this run
  // Re-review 2 Finding 1: Read registry/bsc snapshot and map statusInfo with statusFromInfo
  const regSnap = ctx.store.latest<
    Array<{
      tokenContractAddress?: string;
      platformId?: string;
      statusInfo?: RawStatusInfo | null;
      underlyingTicker?: string;
      tokenSymbol?: string;
    }>
  >("registry", "bsc", {
    maxAgeMs: 600_000,
    now,
  });

  if (!regSnap || !regSnap.data) {
    ctx.onWarn("Registry snapshot missing: registry/bsc");
  } else if (regSnap.stale) {
    ctx.onWarn(`Registry snapshot is stale: registry/bsc (${regSnap.ageMs}ms old)`);
  }

  const registryItems = Array.isArray(regSnap?.data) ? regSnap.data : [];
  const registryByAddress = new Map<
    string,
    {
      statusInfo?: RawStatusInfo | null;
      platformId?: string;
      underlyingTicker?: string;
    }
  >();
  for (const item of registryItems) {
    if (item.tokenContractAddress) {
      registryByAddress.set(item.tokenContractAddress.toLowerCase(), item);
    }
  }

  const prevStatesByToken = new Map<string, TokenState | null>();
  const nextStatesByToken = new Map<string, TokenState>();
  let warnedPauseThisRun = false;

  for (const tokenAddr of allUniqueTokenAddresses) {
    // Re-review 2 Finding 2: Read guardian-state with maxAgeMs of 30 days (unchanged row means unchanged state)
    const prevStateSnap = ctx.store.latest<TokenState>("guardian-state", tokenAddr, {
      maxAgeMs: 30 * 86_400_000, // 30 days
      now,
    });
    const prevMultiplier = prevStateSnap?.data?.multiplier ?? null;
    prevStatesByToken.set(tokenAddr, prevStateSnap?.data ?? null);

    // Finding 1: Compute candidate multiplier from largest balance holding.
    // Carry forward prevMultiplier if candidate is within 100 ppm to avoid rounding alerts on buys.
    const largest = largestHoldingByToken.get(tokenAddr);
    let derivedMultiplier: bigint | null = null;
    if (largest && largest.tokens > 0n) {
      const candidateMultiplier = mulDiv(largest.shares, E18, largest.tokens);
      if (prevMultiplier != null && prevMultiplier > 0n) {
        const diff =
          candidateMultiplier > prevMultiplier
            ? candidateMultiplier - prevMultiplier
            : prevMultiplier - candidateMultiplier;
        const ppm = (diff * 1_000_000n) / prevMultiplier;
        if (ppm < 100n) {
          derivedMultiplier = prevMultiplier;
        } else {
          derivedMultiplier = candidateMultiplier;
        }
      } else {
        derivedMultiplier = candidateMultiplier;
      }
    }

    // Finding 1: Read radar/<lowercase token address> per token with maxAgeMs: 2h
    const radarSnap = ctx.store.latest<RadarSnapshotSubset>("radar", tokenAddr, {
      maxAgeMs: 7_200_000,
      now,
    });

    if (!radarSnap || !radarSnap.data) {
      ctx.onWarn(`Radar snapshot missing for token ${tokenAddr}`);
    } else if (radarSnap.stale) {
      ctx.onWarn(`Radar snapshot is stale for token ${tokenAddr} (${radarSnap.ageMs}ms old)`);
    }

    // Re-review 2 Finding 1: Status mapped from registry/bsc statusInfo
    const regItem = registryByAddress.get(tokenAddr);
    const mappedStatus = statusFromInfo(regItem?.statusInfo);

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

    // Finding 2: Use holding's issuer or radar row's issuer, never default to bstock
    const tokenIssuer =
      issuerByToken.get(tokenAddr) ??
      (radarSnap?.data?.issuer === "ondo" ||
      radarSnap?.data?.issuer === "bstock" ||
      radarSnap?.data?.issuer === "xstocks"
        ? radarSnap.data.issuer
        : null);

    if (!tokenIssuer) {
      ctx.onWarn(`Cannot build token state for ${tokenAddr}: unknown issuer`);
      continue;
    }

    // bStock onchain pause evaluation via injected pauseState accessor
    let isPausedOnchain: boolean | null = null;
    if (tokenIssuer === "bstock") {
      if (ctx.pauseState) {
        try {
          const pauseRes = await ctx.pauseState(tokenAddr);
          isPausedOnchain = pauseRes.paused;
        } catch (err) {
          const rawMsg = err instanceof Error ? err.message : String(err);
          ctx.onWarn(`pauseState failed for ${tokenAddr}: ${redactSecrets(rawMsg)}`);
          isPausedOnchain = null;
        }
      } else {
        isPausedOnchain = null;
        if (!warnedPauseThisRun) {
          ctx.onWarn("bStock pause alerts are inactive: engine.pauseState is not configured");
          warnedPauseThisRun = true;
        }
      }
    }

    // Re-review 2 Finding 6: Use holding.ticker as state ticker
    const ticker = tickerByToken.get(tokenAddr) ?? radarSnap?.data?.ticker ?? "UNKNOWN";

    const nextState = buildTokenStateFromSnapshots({
      tokenAddress: tokenAddr,
      ticker,
      issuer: tokenIssuer,
      observedAt: now,
      rawStatus: mappedStatus,
      rawMultiplier: derivedMultiplier,
      rawRadar: radarSnap?.data,
      rawFlowGhost: ghostSnap?.data,
      rawFlowAggregate: flowSnap?.data,
      isFlowGhostStale: ghostSnap?.stale ?? false,
      sharePriceUsd: priceSnap?.data?.tokenPrice ? Number(priceSnap.data.tokenPrice) : undefined,
      isPausedOnchain,
      onWarn: ctx.onWarn,
    });

    nextStatesByToken.set(tokenAddr, nextState);
  }

  // 4. Evaluate holding rules per wallet against consistent run snapshot (Finding 3)
  const deliveryErrors: string[] = [];
  const sender = ctx.sender;

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

    generatedAlertsCount += walletGeneratedAlerts.length;

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
      let deliveryResult: DeliverAlertsResult;
      if (sender) {
        deliveryResult = await deliverPendingAlerts(
          sender,
          combinedAlerts,
          ctx.store,
          now,
          ctx.onWarn,
        );
        deliveredAlertsCount += deliveryResult.delivered;
        if (deliveryResult.errors.length > 0) {
          deliveryErrors.push(...deliveryResult.errors);
        }
      } else {
        deliveryResult = {
          attempted: 0,
          delivered: 0,
          failed: 0,
          suppressedByQuiet: 0,
          errors: [],
          updatedAlerts: combinedAlerts,
        };
      }

      // Finding 3: Write ONLY when content changed (new alerts or delivery status change)
      if (haveAlertsChanged(alertHistory, deliveryResult.updatedAlerts)) {
        ctx.store.put({
          kind: "alerts",
          key: wallet,
          data: deliveryResult.updatedAlerts,
          source: "guardian",
          observedAt: now,
        });
      }
    }
  }

  // 5. Persist updated token states AFTER all wallets are evaluated (Finding 3)
  // Finding 3: Write ONLY when token state actually changed
  for (const [tokenAddr, nextState] of nextStatesByToken.entries()) {
    const prevState = prevStatesByToken.get(tokenAddr) ?? null;
    if (hasTokenStateChanged(prevState, nextState)) {
      ctx.store.put({
        kind: "guardian-state",
        key: tokenAddr,
        data: nextState,
        source: "guardian",
        observedAt: now,
      });
    }
  }

  // 6. Report health (Finding 7: report error in health if delivery failed)
  if (deliveryErrors.length > 0) {
    ctx.health.report("guardian", {
      ok: false,
      error: `Telegram delivery failed: ${deliveryErrors.slice(0, 3).join("; ")}`,
      now,
    });
  } else {
    ctx.health.report("guardian", { ok: true, now });
  }

  return {
    evaluatedWallets: holdingsByWallet.size,
    generatedAlerts: generatedAlertsCount,
    deliveredAlerts: deliveredAlertsCount,
    deliveryErrors,
  };
}
