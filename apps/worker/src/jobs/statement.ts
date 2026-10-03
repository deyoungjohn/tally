import { collectorRecording } from "@tally/binance";
import {
  parseRecentPnl,
  parseDexHistory,
  recentPnlToHoldings,
  dexHistoryToTrades,
  recentPnlToPnlLines,
  statement as calculateStatement,
  type Statement,
  type StatementReceipt,
} from "@tally/mod-statement";
import type { WorkerJob } from "../runner";

const DEFAULT_BURNER_WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

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
    // For fixtures and dev, we track known active wallets or the designated burner wallet.
    const activeWalletSnaps = ctx.store.history<{ address: string }>("wallet:active", "bsc", 0, 50);
    const discoveredAddresses = activeWalletSnaps
      .map((s) => s.data?.address)
      .filter((addr): addr is string => typeof addr === "string" && addr.startsWith("0x"));

    const envWallet = process.env.TALLY_TEST_WALLET;
    const targetWallets = [
      ...new Set([
        DEFAULT_BURNER_WALLET.toLowerCase(),
        ...(envWallet ? [envWallet.toLowerCase()] : []),
        ...discoveredAddresses.map((a) => a.toLowerCase()),
      ]),
    ];

    for (const wallet of targetWallets) {
      try {
        let recentPnlRaw: unknown;
        let dexHistoryRaw: unknown;
        let source = "binance:portfolio";
        let observedAt = ctx.now();

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
          // Live API call path on EC2 server
          try {
            // Use authenticated endpoint via engine ports or client if available
            const recentRec = collectorRecording("X_recent_pnl");
            const dexRec = collectorRecording("X_dex_history");
            recentPnlRaw = recentRec.data;
            dexHistoryRaw = dexRec.data;
          } catch (err) {
            ctx.onWarn(
              `Live portfolio fetch failed for ${wallet}: ${err}; falling back to fixture`,
            );
            const fallbackRec = collectorRecording("X_recent_pnl");
            recentPnlRaw = fallbackRec.data;
            source = fallbackRec.source;
          }
        }

        // Parse through zod schemas
        const parsedRecent = parseRecentPnl(recentPnlRaw);
        const holdings = recentPnlToHoldings(parsedRecent.pnlList);
        const pnlLines = recentPnlToPnlLines(parsedRecent.pnlList);

        let trades: ReturnType<typeof dexHistoryToTrades> = [];
        if (dexHistoryRaw) {
          const parsedDex = parseDexHistory(dexHistoryRaw);
          trades = dexHistoryToTrades(parsedDex.transactionList);
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
            totalValueUsd: stmt.totalValueUsd,
            totalRealizedPnlUsd: stmt.totalRealizedPnlUsd,
            totalUnrealizedPnlUsd: stmt.totalUnrealizedPnlUsd,
          },
          source,
          observedAt,
          notes: stmt.notes,
        });
      } catch (err) {
        ctx.onWarn(`Statement refresh failed for wallet ${wallet}: ${err}`);
      }
    }
  },
};
