import { collectorRecording, type RwaToken } from "@tally/binance";
import {
  parseRecentPnl,
  parseDexHistory,
  recentPnlToHoldings,
  dexHistoryToTrades,
  recentPnlToPnlLines,
  statement as calculateStatement,
  parseDecimal,
  assertBinanceCredentials,
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
    // Assert credentials upfront when running in live mode
    assertBinanceCredentials(process.env);

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
      const issuer: Issuer | null =
        platform === "ondo"
          ? "ondo"
          : platform === "bstock"
            ? "bstock"
            : platform === "xstocks"
              ? "xstocks"
              : null;
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

    // The authenticated registry snapshot is a truncated list (some Ondo tokens and all xStocks are missing), and a token that
    // is not in the map is dropped as "not a tokenized stock". Fill the gaps from the engine's complete public registry.
    try {
      const complete = (await ctx.engine.ports.registry.all?.()) ?? [];
      for (const t of complete) {
        const addr = t.address.toLowerCase();
        if (registryMap[addr]) continue;
        registryMap[addr] = {
          ticker: t.ticker.toUpperCase(),
          issuer: t.issuer,
          symbol: t.symbol,
          decimals: t.decimals,
        };
      }
    } catch (err) {
      ctx.onWarn(`Could not complete the registry map from the public lists: ${err}`);
    }

    // 3. Fetch raw portfolio data for each target wallet
    interface FetchedWalletData {
      wallet: string;
      parsedRecent: ReturnType<typeof parseRecentPnl>;
      dexHistoryRaw: unknown;
      source: string;
      observedAt: number;
    }

    const fetchedWallets: FetchedWalletData[] = [];
    const errors: Error[] = [];

    for (const wallet of targetWallets) {
      try {
        let recentPnlRaw: unknown;
        let dexHistoryRaw: unknown;
        let source: string;
        let observedAt: number;

        // If fixtures mode is set, read recorded probes
        if (process.env.TALLY_FIXTURES === "1") {
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

        const parsedRecent = parseRecentPnl(recentPnlRaw);
        fetchedWallets.push({
          wallet,
          parsedRecent,
          dexHistoryRaw,
          source,
          observedAt,
        });
      } catch (err) {
        ctx.onWarn(`Portfolio fetch failed for ${wallet}: ${err}`);
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // 4. Build multiplier map once per run from the union of tickers across all wallets
    const tickersToInspect = new Set<string>();
    for (const fw of fetchedWallets) {
      for (const item of fw.parsedRecent.pnlList) {
        const regToken = registryMap[item.tokenContractAddress.toLowerCase()];
        if (regToken?.ticker && regToken.issuer !== null) {
          tickersToInspect.add(regToken.ticker);
        }
      }
      if (fw.dexHistoryRaw) {
        try {
          const parsedDex = parseDexHistory(fw.dexHistoryRaw);
          for (const tx of parsedDex.transactionList) {
            const regToken = registryMap[tx.tokenContractAddress.toLowerCase()];
            if (regToken?.ticker && regToken.issuer !== null) {
              tickersToInspect.add(regToken.ticker);
            }
          }
        } catch {
          // dexHistory parse errors will be handled during wallet processing
        }
      }
    }

    const multiplierMap: Record<string, MultiplierEntry | bigint> = {};
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

    // 5. Compute and store statement and portfolio snapshots for each fetched wallet
    let successCount = 0;
    for (const fw of fetchedWallets) {
      try {
        const holdings = recentPnlToHoldings(fw.parsedRecent.pnlList, registryMap, multiplierMap);
        const pnlLines = recentPnlToPnlLines(fw.parsedRecent.pnlList, registryMap);

        let trades: ReturnType<typeof dexHistoryToTrades> = [];
        if (fw.dexHistoryRaw) {
          const parsedDex = parseDexHistory(fw.dexHistoryRaw);
          trades = dexHistoryToTrades(parsedDex.transactionList, registryMap, multiplierMap);
        }

        // Read any on-chain receipts recorded for this wallet
        const receiptSnaps = ctx.store.history<StatementReceipt>("receipt", fw.wallet, 0, 500);
        const receipts = receiptSnaps.map((s) => s.data);

        // Compute statement domain object
        const stmt: Statement = calculateStatement({
          walletAddress: fw.wallet,
          holdings,
          trades,
          pnlLines,
          receipts,
          asOf: fw.observedAt,
        });

        // Put statement snapshot in SQLite store
        ctx.store.put({
          kind: "statement",
          key: fw.wallet,
          data: stmt,
          source: fw.source,
          observedAt: fw.observedAt,
          notes: stmt.notes,
        });

        // Put portfolio snapshot in SQLite store
        ctx.store.put({
          kind: "portfolio",
          key: fw.wallet,
          data: {
            walletAddress: fw.wallet,
            holdings: stmt.holdings,
            holdingsByTicker: stmt.holdingsByTicker,
            totalValueUsdE18: stmt.totalValueUsdE18,
            totalRealizedPnlUsdE18: stmt.totalRealizedPnlUsdE18,
            totalUnrealizedPnlUsdE18: stmt.totalUnrealizedPnlUsdE18,
            differsFromApi: stmt.differsFromApi,
            source: fw.source,
            asOf: fw.observedAt,
          },
          source: fw.source,
          observedAt: fw.observedAt,
          notes: stmt.notes,
        });

        successCount++;
      } catch (err) {
        ctx.onWarn(`Portfolio calculation failed for ${fw.wallet}: ${err}`);
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
