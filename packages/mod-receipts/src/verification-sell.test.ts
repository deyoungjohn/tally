import { describe, expect, it } from "vitest";
import type { Address, RegistryToken } from "@tally/core";
import { parseReceiptHint, type SellReceiptHint } from "./hints";
import { TRANSFER_TOPIC } from "./decode";
import type { ChainLog, Hex } from "./types";
import type { MinedEvidence, TransactionEvidence } from "./verification";
import {
  DEFAULT_LIQUIDMESH_ROUTER,
  DEFAULT_USDT_BSC,
  promoteSellReceipt,
  reconcileSell,
  verifiedSellFill,
  verifySignedSellCall,
} from "./verification-sell";

const LIQUIDMESH_ROUTER = DEFAULT_LIQUIDMESH_ROUTER;
const USDT_BSC = DEFAULT_USDT_BSC;

const USER = "0xe05fcc23807536bee418f142d19fa0d21bb0cff7" as Address;
const NVDAB_STOCK = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as Address;
const TX_HASH = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hex;
const APPROVE_TARGET = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5" as Address; // configured approveTarget

const NVDA_TOKEN: RegistryToken = {
  ticker: "NVDA",
  issuer: "bstock",
  address: NVDAB_STOCK,
  symbol: "NVDAB",
  decimals: 18,
  assetType: 1,
  multiplierSource: "api",
  executable: true,
};

function padAddress(addr: string): string {
  return addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function padUint256(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function makeTransferLog(
  token: Address,
  from: Address,
  to: Address,
  value: bigint,
  logIndex: number,
): ChainLog {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, `0x${padAddress(from)}` as Hex, `0x${padAddress(to)}` as Hex],
    data: `0x${padUint256(value)}` as Hex,
    transactionHash: TX_HASH,
    blockNumber: 1000n,
    logIndex,
    removed: false,
  };
}

function makeSellHint(overrides: Partial<SellReceiptHint> = {}): SellReceiptHint {
  return {
    version: 1,
    kind: "sell",
    txHash: TX_HASH,
    intentId: "intent-sell-1",
    attempt: 1,
    user: USER,
    ticker: "NVDA",
    isResumed: false,
    quote: {
      stock: NVDAB_STOCK,
      issuer: "bstock",
      tokensIn: "25000000000000000", // 0.025 tokens
      minUsdtOut: "6000000000000000000", // 6.0 USDT floor
      quotedUsdtOut: "6100000000000000000", // 6.1 USDT quote
      hops: 1,
      routeText: "NVDAB → USDT",
      builtAt: 1700000000000,
      expiresAt: 1700000015000,
    },
    simulation: null,
    ...overrides,
  };
}

function makeSellTx(overrides: Partial<TransactionEvidence> = {}): TransactionEvidence {
  return {
    hash: TX_HASH,
    sender: USER,
    destination: LIQUIDMESH_ROUTER,
    value: 0n,
    input: "0x12345678aabbccdd" as Hex,
    inputSelector: "0x12345678" as Hex,
    blockNumber: 1000n,
    gasLimit: 500000n,
    ...overrides,
  };
}

function makeApprovalTx(
  amount = 25000000000000000n,
  spender = APPROVE_TARGET,
  destination = NVDAB_STOCK,
): TransactionEvidence {
  const input = `0x095ea7b3${padAddress(spender)}${padUint256(amount)}` as Hex;
  return {
    hash: TX_HASH,
    sender: USER,
    destination,
    value: 0n,
    input,
    inputSelector: "0x095ea7b3" as Hex,
    blockNumber: 999n,
    gasLimit: 60000n,
  };
}

function makeMined(
  status: "success" | "reverted" = "success",
  logs: ChainLog[] = [],
): MinedEvidence {
  return {
    hash: TX_HASH,
    sender: USER,
    destination: LIQUIDMESH_ROUTER,
    blockNumber: 1000n,
    gasUsed: 250000n,
    status,
    logs,
  };
}

describe("verification-sell", () => {
  describe("verifySignedSellCall", () => {
    it("recognizes allow-listed LiquidMesh router (Condition 1)", () => {
      const hint = makeSellHint();
      const tx = makeSellTx();
      const call = verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET);
      expect(call.kind).toBe("sell");
      if (call.kind === "sell") {
        expect(call.router.toLowerCase()).toBe(LIQUIDMESH_ROUTER.toLowerCase());
        expect(call.stock?.toLowerCase()).toBe(NVDAB_STOCK.toLowerCase());
      }
    });

    it("refuses a sell hint to a non-allow-listed destination (Condition 8)", () => {
      const hint = makeSellHint();
      const oneInchRouter = "0x111111125421ca6dc452d289314280a0f8842a65" as Address;
      const tx = makeSellTx({ destination: oneInchRouter });
      expect(() =>
        verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET, LIQUIDMESH_ROUTER),
      ).toThrow("destination is not the allow-listed LiquidMesh router");
    });

    it("refuses when sender does not match hint user", () => {
      const hint = makeSellHint();
      const tx = makeSellTx({ sender: "0x9999999999999999999999999999999999999999" as Address });
      expect(() => verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET)).toThrow(
        "Transaction sender/hash does not match intent",
      );
    });

    it("refuses when value is non-zero", () => {
      const hint = makeSellHint();
      const tx = makeSellTx({ value: 1000000000000000n });
      expect(() => verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET)).toThrow(
        "Invalid sell transaction",
      );
    });

    it("recognizes stock approval to configured approve target (Condition 2)", () => {
      const hint = makeSellHint();
      const tx = makeApprovalTx();
      const call = verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET);
      expect(call.kind).toBe("stock_approval");
      if (call.kind === "stock_approval") {
        expect(call.stock.toLowerCase()).toBe(NVDAB_STOCK.toLowerCase());
        expect(call.approveTarget.toLowerCase()).toBe(APPROVE_TARGET.toLowerCase());
        expect(call.amount).toBe(25000000000000000n);
      }
    });

    it("refuses stock approval to wrong approve target (Condition 2)", () => {
      const hint = makeSellHint();
      const wrongTarget = "0x1111111111111111111111111111111111111111" as Address;
      const tx = makeApprovalTx(25000000000000000n, wrongTarget);
      expect(() => verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET)).toThrow(
        "Only a stock approval to configured approve target is accepted",
      );
    });

    it("refuses stock approval with unlimited allowance (Condition 2)", () => {
      const hint = makeSellHint();
      const maxUint256 = 2n ** 256n - 1n;
      const tx = makeApprovalTx(maxUint256);
      expect(() => verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET)).toThrow(
        "Only a stock approval to configured approve target is accepted",
      );
    });

    it("refuses stock approval to untrusted destination (Condition 2)", () => {
      const hint = makeSellHint();
      const unknownToken = "0x8888888888888888888888888888888888888888" as Address;
      const tx = makeApprovalTx(25000000000000000n, APPROVE_TARGET, unknownToken);
      expect(() => verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET)).toThrow(
        "destination is not the allow-listed LiquidMesh router",
      );
    });
  });

  describe("verifiedSellFill & log extraction", () => {
    it("computes net USDT correctly when incoming and outgoing transfers exist (Condition 3 & 8)", () => {
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n,
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const otherPool = "0x7777777777777777777777777777777777777777" as Address;
      const logs: ChainLog[] = [
        // User sends 0.025 stock tokens
        makeTransferLog(NVDAB_STOCK, USER, otherPool, 25000000000000000n, 0),
        // User receives 7.0 USDT
        makeTransferLog(USDT_BSC, otherPool, USER, 7000000000000000000n, 1),
        // Fee or hop takes back 0.9 USDT from user
        makeTransferLog(USDT_BSC, USER, otherPool, 900000000000000000n, 2),
      ];

      const minedEvidence = makeMined("success", logs);
      const fill = verifiedSellFill(tx, minedEvidence, call, [NVDA_TOKEN], USDT_BSC);

      expect(fill).not.toBeNull();
      expect(fill!.tokensSpent).toBe(25000000000000000n);
      // Net USDT = 7.0 - 0.9 = 6.1 USDT
      expect(fill!.usdtReceived).toBe(6100000000000000000n);
    });

    it("marks status as UNRECONCILED when no stock Transfer from sender exists (Condition 3 & 8)", () => {
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n,
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const other = "0x3333333333333333333333333333333333333333" as Address;
      const logs: ChainLog[] = [
        // Someone else transfers stock
        makeTransferLog(NVDAB_STOCK, other, LIQUIDMESH_ROUTER, 25000000000000000n, 0),
        // User gets USDT
        makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 1),
      ];

      const minedEvidence = makeMined("success", logs);
      const fill = verifiedSellFill(tx, minedEvidence, call, [NVDA_TOKEN], USDT_BSC);
      const result = reconcileSell(
        tx,
        minedEvidence,
        call,
        fill,
        null,
        null,
        call.minUsdtOut,
        call.quotedUsdtOut,
      );

      expect(result.status).toBe("UNRECONCILED");
      expect(result.notes.some((n) => n.includes("No stock Transfer from the sender"))).toBe(true);
    });

    it("sets shares to null with clear reason when multiplier unavailable (Condition 4 & 8)", () => {
      const hint = makeSellHint();
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n,
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const logs: ChainLog[] = [
        makeTransferLog(NVDAB_STOCK, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0),
        makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 1),
      ];
      const minedEvidence = makeMined("success", logs);

      // Multiplier is null (unavailable)
      const stored = promoteSellReceipt(
        hint,
        tx,
        minedEvidence,
        call,
        NVDA_TOKEN,
        null,
        Date.now(),
      );

      expect(stored.result?.status).toBe("RECONCILED");
      expect(stored.verifiedFill?.shares).toBeNull();
      expect(stored.result?.sharesReceived).toBeNull();
      expect(stored.receipt?.conversion).toBeNull();
      expect(stored.receipt?.conversionMissingReason).toContain("Multiplier unavailable");
    });

    it("derives shares with engine multiplier and labels source and time (Condition 4)", () => {
      const hint = makeSellHint();
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n,
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const logs: ChainLog[] = [
        makeTransferLog(NVDAB_STOCK, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0),
        makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 1),
      ];
      const minedEvidence = makeMined("success", logs);

      const multiplierEvidence = {
        value: 1000778223752807865n,
        source: "onchain-reading",
        observedAt: 1700000005000,
      };

      const stored = promoteSellReceipt(
        hint,
        tx,
        minedEvidence,
        call,
        NVDA_TOKEN,
        multiplierEvidence,
        Date.now(),
      );

      expect(stored.result?.status).toBe("RECONCILED");
      expect(stored.verifiedFill?.shares).not.toBeNull();
      // (25000000000000000n * 1000778223752807865n) / 1e18 = 25019455593820196n
      expect(stored.verifiedFill?.shares).toBe(25019455593820196n);
      expect(stored.receipt?.conversion?.source).toBe("onchain-reading");
    });

    it("marks status as UNRECONCILED when net USDT is below client-reported floor (Condition 5)", () => {
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n, // floor is 6.0 USDT
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const logs: ChainLog[] = [
        makeTransferLog(NVDAB_STOCK, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0),
        // Only 5.5 USDT received (below 6.0 floor)
        makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 5500000000000000000n, 1),
      ];
      const minedEvidence = makeMined("success", logs);
      const fill = verifiedSellFill(tx, minedEvidence, call, [NVDA_TOKEN], USDT_BSC);
      const result = reconcileSell(
        tx,
        minedEvidence,
        call,
        fill,
        25000000000000000n,
        null,
        call.minUsdtOut,
        call.quotedUsdtOut,
      );

      expect(result.status).toBe("UNRECONCILED");
      expect(result.notes.some((n) => n.includes("below client-reported floor"))).toBe(true);
    });

    it("marks status as FAILED when transaction reverted (Condition 5)", () => {
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n,
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const minedEvidence = makeMined("reverted", []);
      const fill = verifiedSellFill(tx, minedEvidence, call, [NVDA_TOKEN], USDT_BSC);
      const result = reconcileSell(
        tx,
        minedEvidence,
        call,
        fill,
        null,
        null,
        call.minUsdtOut,
        call.quotedUsdtOut,
      );

      expect(result.status).toBe("FAILED");
      expect(result.notes).toContain("Transaction reverted on chain");
    });
  });

  describe("Hint parser backwards compatibility (Condition 6 & 8)", () => {
    it("keeps accepting exact existing buy hint shape (Condition 6 & 8)", () => {
      const buyPayload = {
        version: 1,
        txHash: TX_HASH,
        intentId: "intent-buy-1",
        attempt: 1,
        user: USER,
        ticker: "NVDA",
        isResumed: false,
        quote: {
          stock: NVDAB_STOCK,
          issuer: "bstock",
          tokensOut: "25000000000000000",
          multiplier: "1000000000000000000",
          minShares: "24900000000000000",
          amountInUsdt: "6000000000000000000",
          hops: 1,
          routeText: "USDT → NVDAB",
          builtAt: 1700000000000,
          expiresAt: 1700000015000,
        },
        simulation: null,
      };

      const parsed = parseReceiptHint(buyPayload);
      expect(parsed).not.toBeNull();
      expect(parsed?.ticker).toBe("NVDA");
      expect(parsed?.quote?.stock.toLowerCase()).toBe(NVDAB_STOCK.toLowerCase());
    });

    it("accepts separate strict sell hint shape (Condition 6)", () => {
      const sellPayload = {
        version: 1,
        kind: "sell" as const,
        txHash: TX_HASH,
        intentId: "intent-sell-1",
        attempt: 1,
        user: USER,
        ticker: "NVDA",
        isResumed: false,
        quote: {
          stock: NVDAB_STOCK,
          issuer: "bstock",
          tokensIn: "25000000000000000",
          minUsdtOut: "6000000000000000000",
          quotedUsdtOut: "6100000000000000000",
          hops: 1,
          routeText: "NVDAB → USDT",
          builtAt: 1700000000000,
          expiresAt: 1700000015000,
        },
        simulation: null,
      };

      const parsed = parseReceiptHint(sellPayload);
      expect(parsed).not.toBeNull();
      expect(parsed?.kind).toBe("sell");
      if (parsed && parsed.kind === "sell" && parsed.quote) {
        expect(parsed.quote.tokensIn).toBe("25000000000000000");
        expect(parsed.quote.minUsdtOut).toBe("6000000000000000000");
      }
    });

    it("rejects malformed sell hint shape with unexpected keys", () => {
      const malformedSellPayload = {
        version: 1,
        kind: "sell" as const,
        txHash: TX_HASH,
        intentId: "intent-sell-1",
        attempt: 1,
        user: USER,
        ticker: "NVDA",
        isResumed: false,
        extraProperty: "bad",
        quote: null,
        simulation: null,
      };

      const parsed = parseReceiptHint(malformedSellPayload);
      expect(parsed).toBeNull();
    });
  });

  describe("Review fixes (Findings 1, 2, 3)", () => {
    it("refuses stock approval to a different spender (Finding 1)", () => {
      const wrongSpender = "0x1111111111111111111111111111111111111111" as Address;
      const tx = makeApprovalTx(25000000000000000n, wrongSpender, NVDAB_STOCK);
      const hint = makeSellHint();

      expect(() =>
        verifySignedSellCall(tx, hint, [NVDA_TOKEN], APPROVE_TARGET, LIQUIDMESH_ROUTER),
      ).toThrow("Only a stock approval to configured approve target is accepted");
    });

    it("log strictness: rejects fill when log blockNumber does not match receipt (Finding 2)", () => {
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n,
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const badLog = makeTransferLog(NVDAB_STOCK, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0);
      badLog.blockNumber = 999n;
      const usdtLog = makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 1);
      const minedEvidence = makeMined("success", [badLog, usdtLog]);

      const fill = verifiedSellFill(tx, minedEvidence, call, [NVDA_TOKEN], USDT_BSC);
      expect(fill).toBeNull();

      const result = reconcileSell(
        tx,
        minedEvidence,
        call,
        fill,
        null,
        null,
        call.minUsdtOut,
        call.quotedUsdtOut,
      );
      expect(result.status).toBe("UNRECONCILED");
    });

    it("log strictness: rejects fill when log transactionHash does not match receipt (Finding 2)", () => {
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n,
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const badLog = makeTransferLog(NVDAB_STOCK, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0);
      badLog.transactionHash =
        "0x9999999999999999999999999999999999999999999999999999999999999999" as Hex;
      const usdtLog = makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 1);
      const minedEvidence = makeMined("success", [badLog, usdtLog]);

      const fill = verifiedSellFill(tx, minedEvidence, call, [NVDA_TOKEN], USDT_BSC);
      expect(fill).toBeNull();
    });

    it("log strictness: rejects fill when duplicate logIndex is present (Finding 2)", () => {
      const tx = makeSellTx();
      const call = {
        kind: "sell" as const,
        stock: NVDAB_STOCK,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: 6000000000000000000n,
        quotedUsdtOut: 6100000000000000000n,
        tokensIn: 25000000000000000n,
      };

      const log1 = makeTransferLog(NVDAB_STOCK, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0);
      const log2 = makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 0);
      const minedEvidence = makeMined("success", [log1, log2]);

      const fill = verifiedSellFill(tx, minedEvidence, call, [NVDA_TOKEN], USDT_BSC);
      expect(fill).toBeNull();
    });

    it("stock attribution without a quote: picks the trusted token with Transfer out of sender (Finding 3)", () => {
      const tx = makeSellTx();
      const callWithoutQuoteStock = {
        kind: "sell" as const,
        stock: null,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: null,
        quotedUsdtOut: null,
        tokensIn: null,
      };

      const NVDAON_STOCK = "0xa9ee28c80f960b889dfbd1902055218cba016f75" as Address;
      const NVDAON_TOKEN: RegistryToken = {
        ticker: "NVDA",
        issuer: "ondo",
        address: NVDAON_STOCK,
        symbol: "NVDAon",
        decimals: 18,
        assetType: 1,
        multiplierSource: "onchain-multiplier",
        executable: true,
      };

      const logs: ChainLog[] = [
        makeTransferLog(NVDAB_STOCK, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0),
        makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 1),
      ];
      const minedEvidence = makeMined("success", logs);

      const fill = verifiedSellFill(
        tx,
        minedEvidence,
        callWithoutQuoteStock,
        [NVDA_TOKEN, NVDAON_TOKEN],
        USDT_BSC,
      );
      expect(fill).not.toBeNull();
      expect(fill?.stockAddress).toBe(NVDAB_STOCK);
      expect(fill?.tokensSpent).toBe(25000000000000000n);
      expect(fill?.usdtReceived).toBe(6100000000000000000n);
    });

    it("stock attribution without a quote: returns null when no trusted token transferred out (Finding 3)", () => {
      const tx = makeSellTx();
      const callWithoutQuoteStock = {
        kind: "sell" as const,
        stock: null,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: null,
        quotedUsdtOut: null,
        tokensIn: null,
      };

      const someOtherToken = "0x8888888888888888888888888888888888888888" as Address;
      const logs: ChainLog[] = [
        makeTransferLog(someOtherToken, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0),
        makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 1),
      ];
      const minedEvidence = makeMined("success", logs);

      const fill = verifiedSellFill(
        tx,
        minedEvidence,
        callWithoutQuoteStock,
        [NVDA_TOKEN],
        USDT_BSC,
      );
      expect(fill).toBeNull();
    });

    it("stock attribution without a quote: returns null when multiple trusted tokens transferred out (Finding 3)", () => {
      const tx = makeSellTx();
      const callWithoutQuoteStock = {
        kind: "sell" as const,
        stock: null,
        router: LIQUIDMESH_ROUTER,
        minUsdtOut: null,
        quotedUsdtOut: null,
        tokensIn: null,
      };

      const NVDAON_STOCK = "0xa9ee28c80f960b889dfbd1902055218cba016f75" as Address;
      const NVDAON_TOKEN: RegistryToken = {
        ticker: "NVDA",
        issuer: "ondo",
        address: NVDAON_STOCK,
        symbol: "NVDAon",
        decimals: 18,
        assetType: 1,
        multiplierSource: "onchain-multiplier",
        executable: true,
      };

      const logs: ChainLog[] = [
        makeTransferLog(NVDAB_STOCK, USER, LIQUIDMESH_ROUTER, 25000000000000000n, 0),
        makeTransferLog(NVDAON_STOCK, USER, LIQUIDMESH_ROUTER, 10000000000000000n, 1),
        makeTransferLog(USDT_BSC, LIQUIDMESH_ROUTER, USER, 6100000000000000000n, 2),
      ];
      const minedEvidence = makeMined("success", logs);

      const fill = verifiedSellFill(
        tx,
        minedEvidence,
        callWithoutQuoteStock,
        [NVDA_TOKEN, NVDAON_TOKEN],
        USDT_BSC,
      );
      expect(fill).toBeNull();
    });
  });
});
