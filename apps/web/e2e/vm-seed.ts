/**
 * Seeds an isolated TALLY_DATA_DIR with recorded-style statement snapshots for the view-model e2e (run through tsx, never in
 * production). It writes through the same store the app reads: nothing here touches a network or a secret.
 */
import { E18, parseDecimal, statement, type Holding, type Trade } from "@tally/mod-statement";
import { openStore } from "@tally/modkit";
import { recordedHint } from "../../../packages/mod-receipts/src/fixtures/ingestion";

const WALLET = recordedHint("F11_NVDAB").user;

const holding = (over: Partial<Holding> & Pick<Holding, "tokenSymbol" | "ticker">): Holding => ({
  tokenContractAddress: "0x0000000000000000000000000000000000000001",
  issuer: null,
  isRecognized: true,
  balanceTokens: 0n,
  multiplier: E18,
  balanceShares: 0n,
  convertedAtTodaysRatio: false,
  tokenBalanceUsdE18: 0n,
  costBasisUsdE18: 0n,
  avgCostPerShareUsdE18: null,
  pricePerShareUsdE18: null,
  unrealizedPnlUsdE18: 0n,
  source: "fixture",
  ...over,
});

async function main() {
  if (!process.env.TALLY_DATA_DIR) throw new Error("vm-seed needs an isolated TALLY_DATA_DIR");
  const mode = process.argv[2] ?? "full";
  const store = openStore();
  const now = Date.now();
  try {
    if (mode === "full") {
      const nvdaOn = holding({
        tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        tokenSymbol: "NVDAon",
        ticker: "NVDA",
        issuer: "ondo",
        balanceTokens: parseDecimal("0.5", 18),
        multiplier: parseDecimal("1.0017", 18),
        balanceShares: parseDecimal("0.50085", 18),
        tokenBalanceUsdE18: parseDecimal("117.15", 18),
        costBasisUsdE18: parseDecimal("115", 18),
        avgCostPerShareUsdE18: parseDecimal("229.6", 18),
        pricePerShareUsdE18: parseDecimal("233.9", 18),
        unrealizedPnlUsdE18: parseDecimal("2.15", 18),
      });
      const nvdaB = holding({
        tokenContractAddress: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
        tokenSymbol: "NVDAB",
        ticker: "NVDA",
        issuer: "bstock",
        balanceTokens: parseDecimal("0.0257", 18),
        multiplier: parseDecimal("1.000778", 18),
        balanceShares: parseDecimal("0.0257", 18),
        tokenBalanceUsdE18: parseDecimal("6.01", 18),
        costBasisUsdE18: parseDecimal("6", 18),
        avgCostPerShareUsdE18: parseDecimal("233.5", 18),
        pricePerShareUsdE18: parseDecimal("233.9", 18),
        unrealizedPnlUsdE18: parseDecimal("0.01", 18),
      });
      const dust = holding({
        tokenContractAddress: "0x5b1910ea0000000000000000000000000000dead",
        tokenSymbol: "TSLAB",
        ticker: "TSLA",
        issuer: "bstock",
        balanceTokens: parseDecimal("0.01", 18),
        multiplier: parseDecimal("1", 18),
        balanceShares: parseDecimal("0.01", 18),
        tokenBalanceUsdE18: parseDecimal("2.5", 18),
        costBasisUsdE18: parseDecimal("2.6", 18),
        avgCostPerShareUsdE18: parseDecimal("260", 18),
        pricePerShareUsdE18: parseDecimal("250", 18),
        unrealizedPnlUsdE18: parseDecimal("-0.1", 18),
      });
      const unknown = holding({
        tokenContractAddress: "0x2494b603319d4d9f9715c9f4496d9e0364b59d93",
        tokenSymbol: "TSLAon",
        ticker: "TSLA",
        issuer: "ondo",
        balanceTokens: parseDecimal("0.02", 18),
        multiplier: null,
        balanceShares: null,
        sharesUnavailableReason: "No multiplier observation",
        tokenBalanceUsdE18: 0n,
      });
      const trades: Trade[] = [
        {
          txHash: `0x${"a1".repeat(32)}`,
          time: now - 86_400_000 * 3,
          type: "BUY",
          tokenContractAddress: nvdaOn.tokenContractAddress,
          tokenSymbol: "NVDAon",
          ticker: "NVDA",
          issuer: "ondo",
          isRecognized: true,
          amountTokens: parseDecimal("0.5", 18),
          multiplier: parseDecimal("1.0017", 18),
          amountShares: parseDecimal("0.50085", 18),
          convertedAtTodaysRatio: false,
          pricePerTokenUsdE18: parseDecimal("230", 18),
          pricePerShareUsdE18: parseDecimal("229.6", 18),
          valueUsdE18: parseDecimal("115", 18),
        },
        {
          txHash: `0x${"b2".repeat(32)}`,
          time: now - 86_400_000,
          type: "SELL",
          tokenContractAddress: nvdaB.tokenContractAddress,
          tokenSymbol: "NVDAB",
          ticker: "NVDA",
          issuer: "bstock",
          isRecognized: true,
          amountTokens: parseDecimal("0.01", 18),
          multiplier: parseDecimal("1.000778", 18),
          amountShares: parseDecimal("0.01", 18),
          convertedAtTodaysRatio: true,
          pricePerTokenUsdE18: parseDecimal("234", 18),
          pricePerShareUsdE18: parseDecimal("233.8", 18),
          valueUsdE18: parseDecimal("2.34", 18),
          realizedPnlUsdE18: parseDecimal("0.03", 18),
        },
      ];
      const stmt = statement({
        walletAddress: WALLET,
        holdings: [nvdaOn, nvdaB, dust, unknown],
        trades,
        asOf: now,
      });
      store.put({
        kind: "statement",
        key: WALLET.toLowerCase(),
        source: "recorded-fixture",
        observedAt: now,
        data: stmt,
      });
      // A second wallet whose snapshot is old enough to be stale (older than the 5-minute freshness window).
      store.put({
        kind: "statement",
        key: "0x1111111111111111111111111111111111111111",
        source: "recorded-fixture",
        observedAt: now - 20 * 60_000,
        data: statement({
          walletAddress: "0x1111111111111111111111111111111111111111",
          holdings: [nvdaOn],
          asOf: now - 20 * 60_000,
        }),
      });
    }
    // "empty": the module is healthy but this wallet has no snapshot at all.
    store.health.report("statement", { ok: true, now, intervalMs: 300_000 });
    store.health.report("receipts", { ok: true, now, intervalMs: 15_000 });
  } finally {
    store.close();
  }
}
main().catch((e) => {
  console.error("vm seed failed", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
