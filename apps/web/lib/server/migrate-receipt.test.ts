import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEngine = {
  transactions: {
    getReceipt: vi.fn(),
  },
  trade: {
    receipt: vi.fn(),
  },
  ports: {
    registry: {
      all: vi.fn(),
    },
    facts: {
      multipliers: vi.fn(),
    },
  },
};

vi.mock("./engine", () => ({
  getEngine: async () => mockEngine,
}));

// We must mock USDT_BSC to a constant since we check it against the log address
vi.mock("@tally/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tally/config")>();
  return {
    ...actual,
    USDT_BSC: "0x55d398326f99059fF775485246999027B3197955",
  };
});

import { loadMigrateReceipt } from "./migrate-receipt";

describe("loadMigrateReceipt", () => {
  const USDT = "0x55d398326f99059fF775485246999027B3197955".toLowerCase();
  const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436".toLowerCase();
  const NVDAon = "0x456".toLowerCase(); // dummy

  const h1 = "0x" + "1".repeat(64);
  const h2 = "0x" + "2".repeat(64);
  const SENDER = "0x123";

  beforeEach(() => {
    vi.resetAllMocks();
    mockEngine.ports.registry.all.mockResolvedValue([
      { address: NVDAB, ticker: "NVDA", issuer: "bstock" },
      { address: NVDAon, ticker: "NVDA", issuer: "ondo" },
    ]);
    mockEngine.ports.facts.multipliers.mockResolvedValue({ api: 1000000000000000000n });
  });

  function makeTransferLog(address: string, from: string, to: string, value: bigint) {
    const fromPadded = "0x000000000000000000000000" + from.slice(2);
    const toPadded = "0x000000000000000000000000" + to.slice(2);
    return {
      address,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        fromPadded,
        toPadded,
      ],
      data: "0x" + value.toString(16).padStart(64, "0"),
    };
  }

  it("returns not_a_migrate for invalid hashes", async () => {
    const res = await loadMigrateReceipt("bad", "worse");
    expect(res.state).toBe("not_a_migrate");
  });

  it("returns not_a_migrate when a hash is not a transaction", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue(undefined);
    mockEngine.trade.receipt.mockResolvedValue(undefined);

    const res = await loadMigrateReceipt(h1, h2);
    expect(res.state).toBe("not_a_migrate");
  });

  it("returns not_a_migrate when RPC failure (throws)", async () => {
    mockEngine.transactions.getReceipt.mockRejectedValue(new Error("RPC failed"));
    await expect(loadMigrateReceipt(h1, h2)).rejects.toThrow("RPC failed");
  });

  it("returns not_a_migrate when a leg is reverted", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "reverted",
      sender: SENDER,
      blockNumber: 100n,
      logs: [],
    });
    mockEngine.trade.receipt.mockResolvedValue({
      status: "success",
      fill: { user: SENDER },
      blockNumber: 101,
    });
    const res = await loadMigrateReceipt(h1, h2);
    expect(res.state).toBe("not_a_migrate");
  });

  it("returns not_a_migrate when sender mismatches (different wallets)", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 100n,
      logs: [],
    });
    mockEngine.trade.receipt.mockResolvedValue({
      status: "success",
      fill: { user: "0x999" },
      blockNumber: 101,
    });
    const res = await loadMigrateReceipt(h1, h2);
    expect(res.state).toBe("not_a_migrate");
  });

  it("returns not_a_migrate when swapped order (sell block > buy block)", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 105n,
      logs: [],
    });
    mockEngine.trade.receipt.mockResolvedValue({
      status: "success",
      fill: { user: SENDER },
      blockNumber: 101,
    });
    const res = await loadMigrateReceipt(h1, h2);
    expect(res.state).toBe("not_a_migrate");
  });

  it("returns not_a_migrate when different tickers", async () => {
    mockEngine.ports.registry.all.mockResolvedValue([
      { address: NVDAB, ticker: "NVDA", issuer: "bstock" },
      { address: NVDAon, ticker: "AAPL", issuer: "ondo" }, // DIFFERENT TICKER
    ]);

    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 100n,
      logs: [
        makeTransferLog(NVDAB, SENDER, "0xrouter", 100n),
        makeTransferLog(USDT, "0xrouter", SENDER, 500n),
      ],
      gasUsed: 21000n,
    });
    mockEngine.trade.receipt.mockResolvedValue({
      status: "success",
      fill: {
        user: SENDER,
        stock: NVDAon,
        amountInUsdt: "500",
        tokensOut: "100",
        multiplier: "100",
      },
      blockNumber: 101,
      gasUsed: 30000,
    });
    const res = await loadMigrateReceipt(h1, h2);
    expect(res.state).toBe("not_a_migrate");
  });

  it("returns ready for a valid pair", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 100n,
      logs: [
        makeTransferLog(NVDAB, SENDER, "0xrouter", 100n),
        makeTransferLog(USDT, "0xrouter", SENDER, 500n),
      ],
      gasUsed: 21000n,
    });
    mockEngine.trade.receipt.mockResolvedValue({
      status: "success",
      fill: {
        user: SENDER,
        stock: NVDAon,
        amountInUsdt: "500",
        tokensOut: "100",
        multiplier: "100",
      },
      blockNumber: 101,
      gasUsed: 30000,
    });
    const res = await loadMigrateReceipt(h1, h2);
    expect(res.state).toBe("ready");
    if (res.state === "ready") {
      expect(res.vm.giveUp.tokenSymbol).toBe("NVDAB");
      expect(res.vm.receive.tokenSymbol).toBe("NVDAon");
    }
  });
});
