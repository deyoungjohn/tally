import { collectorRecording, type RwaToken } from "@tally/binance";
import {
  parseRecentPnl,
  parseDexHistory,
  recentPnlToHoldings,
  dexHistoryToTrades,
  recentPnlToPnlLines,
  statement as calculateStatement,
  parseDecimal,
  type Issuer,
  type Statement,
  type StatementReceipt,
  type TokenRegistryInfo,
  type MultiplierEntry,
} from "@tally/mod-statement";
import type { WorkerJob } from "../runner";

/**
 * Worker job for WO-03:
 * Refreshes portfolio & statement snapshots for connected wallets every 5 minutes.
 * Reads Privy session addresses on the server (never storing secrets client-side).
 */
export const job: WorkerJob = {
  name: "statement",
  intervalMs: 300_000, // 5 minutes
  async run(ctx) {
    // 1. Discover active/connected wallet addresses
    // In production, addresses come from server-side Privy sessions.
    const activeWalletSnaps = ctx.store.history<{ address: string }>("wallet:active", "bsc", 0, 50);
    const discoveredAddresses = activeWalletSnaps
      .map((s) => s.data?.address)
      .filter((addr): addr is string => typeof addr === "string" && addr.startsWith("0x"));

    const envWallet = process.env.TALLY_TEST_WALLET;
    const allowTestWallet = envWallet && process.env.NODE_ENV !== "production";

    const targetWallets = [
      ...new Set([
        ...(allowTestWallet && envWallet ? [envWallet.toLowerCase()] : []),
        ...discoveredAddresses.map((a) => a.toLowerCase()),
      ]),
    ];

    if (targetWallets.length === 0) {
      return; // Nothing to process if no active wallets
    }

    // 2. Load registry mapping from registry snapshot or engine
    let rwaTokens: RwaToken[] = [];
    const registrySnap = ctx.store.latest<RwaToken[]>("registry", "bsc", {
      maxAgeMs: 600_000,
      now: ctx.now(),
    });
    if (registrySnap?.data) {
      rwaTokens = registrySnap.data;
    } else {
      try {
        rwaTokens = (await ctx.engine.collectors.registry()).filter(
          (r) => r.binanceChainId === "56",
        );
      } catch (err) {
        ctx.onWarn(`Failed to fetch registry from collector: ${err}`);
      }
    }

    const registryMap: Record<string, TokenRegistryInfo> = {};
    for (const r of rwaTokens) {
      const addr = r.tokenContractAddress.toLowerCase();
      const platform = r.platformId.toLowerCase();
      const issuer: Issuer =
        platform === "bstock" ? "bstock" : platform === "xstocks" ? "xstocks" : "ondo";
      let tokenToShareRatio: bigint | undefined;
      if (r.tokenToShareRatio) {
        try {
          tokenToShareRatio = parseDecimal(r.tokenToShareRatio, 18);
        } catch {
          // ignore parsing error
        }
      }
      registryMap[addr] = {
        ticker: r.underlyingTicker.toUpperCase(),
        issuer,
        symbol: r.tokenSymbol,
        decimals: Number(r.decimals || 18),
        tokenToShareRatio,
      };
    }

    let successCount = 0;
    const errors: Error[] = [];

    for (const wallet of targetWallets) {
      try {
        let recentPnlRaw: unknown;
        let dexHistoryRaw: unknown;
        let source: string;
        let observedAt: number;

        // If fixtures mode or live API not configured, read recorded probes
        if (
          process.env.TALLY_FIXTURES === "1" ||
          !process.env.BINANCE_W3_API_KEY ||
          !process.env.BINANCE_W3_API_SECRET
        ) {
          const recentRec = collectorRecording("X_recent_pnl");
          const dexRec = collectorRecording("X_dex_history");
          recentPnlRaw = recentRec.data;
          dexHistoryRaw = dexRec.data;
          source = recentRec.source;
          observedAt = recentRec.observedAt;
        } else {
          // Real live API call via engine.collectors
          const [recentRes, dexRes] = await Promise.all([
            ctx.engine.collectors.recentPnl(wallet),
            ctx.engine.collectors.dexHistory(wallet),
          ]);
          recentPnlRaw = recentRes;
          dexHistoryRaw = dexRes;
          source = "binance:portfolio";
          observedAt = ctx.now();
        }

        // Parse through zod schemas
        const parsedRecent = parseRecentPnl(recentPnlRaw);

        // Build multiplier map from engine facts and registry readings
        const multiplierMap: Record<string, MultiplierEntry | bigint> = {};
        const tickersToInspect = new Set<string>();

        for (const item of parsedRecent.pnlList) {
          const regToken = registryMap[item.tokenContractAddress.toLowerCase()];
          if (regToken) {
            tickersToInspect.add(regToken.ticker);
          }
        }

        for (const ticker of tickersToInspect) {
          try {
            const inspections = await ctx.engine.facts(ticker);
            for (const insp of inspections) {
              const inspAddr = insp.address.toLowerCase();
              if (insp.multiplier?.value) {
                multiplierMap[inspAddr] = {
                  multiplier: insp.multiplier.value,
                  isTodaysRatio: false,
                  source: insp.multiplier.source,
                };
              }
            }
          } catch (err) {
            ctx.onWarn(`Failed to inspect facts for ${ticker}: ${err}`);
          }
        }

        const holdings = recentPnlToHoldings(parsedRecent.pnlList, registryMap, multiplierMap);
        const pnlLines = recentPnlToPnlLines(parsedRecent.pnlList, registryMap);

        let trades: ReturnType<typeof dexHistoryToTrades> = [];
        if (dexHistoryRaw) {
          const parsedDex = parseDexHistory(dexHistoryRaw);
          trades = dexHistoryToTrades(parsedDex.transactionList, registryMap, multiplierMap);
        }

        // Read any on-chain receipts recorded for this wallet
        const receiptSnaps = ctx.store.history<StatementReceipt>("receipt", wallet, 0, 500);
        const receipts = receiptSnaps.map((s) => s.data);

        // Compute statement domain object
        const stmt: Statement = calculateStatement({
          walletAddress: wallet,
          holdings,
          trades,
          pnlLines,
          receipts,
          asOf: observedAt,
        });

        // Put statement snapshot in SQLite store
        ctx.store.put({
          kind: "statement",
          key: wallet,
          data: stmt,
          source,
          observedAt,
          notes: stmt.notes,
        });

        // Put portfolio snapshot in SQLite store
        ctx.store.put({
          kind: "portfolio",
          key: wallet,
          data: {
            walletAddress: wallet,
            holdings: stmt.holdings,
            holdingsByTicker: stmt.holdingsByTicker,
            totalValueUsdE18: stmt.totalValueUsdE18,
            totalRealizedPnlUsdE18: stmt.totalRealizedPnlUsdE18,
            totalUnrealizedPnlUsdE18: stmt.totalUnrealizedPnlUsdE18,
            differsFromApi: stmt.differsFromApi,
            source,
            asOf: observedAt,
          },
          source,
          observedAt,
          notes: stmt.notes,
        });

        successCount++;
      } catch (err) {
        ctx.onWarn(`Portfolio fetch/calculate failed for ${wallet}: ${err}`);
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    if (targetWallets.length > 0 && successCount === 0) {
      throw new Error(
        `All ${targetWallets.length} target wallet portfolio jobs failed: ${errors[0]?.message ?? "unknown error"}`,
      );
    }
  },
};
