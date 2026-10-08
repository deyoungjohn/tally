import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEngine = {
  transactions: {
    getReceipt: vi.fn(),
  },
  ports: {
    registry: {
      all: vi.fn(),
    },
  },
};

vi.mock("./engine", () => ({
  getEngine: async () => mockEngine,
}));

vi.mock("@tally/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tally/config")>();
  return {
    ...actual,
    USDT_BSC: "0x55d398326f99059fF775485246999027B3197955",
  };
});

import { loadSaleProceeds } from "./sale-proceeds";

describe("loadSaleProceeds", () => {
  const USDT = "0x55d398326f99059fF775485246999027B3197955".toLowerCase();
  const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436".toLowerCase();
  const NVDAon = "0x4560000000000000000000000000000000000000".toLowerCase();
  const SENDER = "0x1230000000000000000000000000000000000000".toLowerCase();
  const ROUTER = "0x9990000000000000000000000000000000000000".toLowerCase();
  const HASH = "0x" + "b".repeat(64);

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

  beforeEach(() => {
    vi.resetAllMocks();
    mockEngine.ports.registry.all.mockResolvedValue([
      { address: NVDAB, ticker: "NVDA", issuer: "bstock" },
      { address: NVDAon, ticker: "NVDA", issuer: "ondo" },
    ]);
  });

  it("returns confirmed fixture when TALLY_FIXTURES=1 and hash starts with 0xf11", async () => {
    process.env.TALLY_FIXTURES = "1";
    try {
      const res = await loadSaleProceeds("0xf11" + "1".repeat(61));
      expect(res.state).toBe("confirmed");
      if (res.state === "confirmed") {
        expect(res.usdtReceivedRaw).toBe("3500000000000000000000");
      }
    } finally {
      delete process.env.TALLY_FIXTURES;
    }
  });

  it("returns pending when receipt is null", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue(null);
    const res = await loadSaleProceeds(HASH);
    expect(res).toEqual({ state: "pending" });
  });

  it("returns failed when receipt reverted", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "reverted",
      sender: SENDER,
      blockNumber: 100n,
      logs: [],
    });
    const res = await loadSaleProceeds(HASH);
    expect(res).toEqual({ state: "failed" });
  });

  it("returns confirmed when valid sale receipt is parsed", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 100n,
      logs: [
        makeTransferLog(NVDAB, SENDER, ROUTER, 100n),
        makeTransferLog(USDT, ROUTER, SENDER, 6500000000000000000n),
      ],
    });
    const res = await loadSaleProceeds(HASH);
    expect(res).toEqual({
      state: "confirmed",
      usdtReceivedRaw: "6500000000000000000",
      tokensSpentRaw: "100",
      stockToken: NVDAB,
      blockNumber: 100,
    });
  });

  it("returns unrecognised when no USDT received", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 100n,
      logs: [makeTransferLog(NVDAB, SENDER, ROUTER, 100n)],
    });
    const res = await loadSaleProceeds(HASH);
    expect(res).toEqual({ state: "unrecognised" });
  });

  it("returns unrecognised when 2 stock tokens transferred", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 100n,
      logs: [
        makeTransferLog(NVDAB, SENDER, ROUTER, 100n),
        makeTransferLog(NVDAon, SENDER, ROUTER, 100n),
        makeTransferLog(USDT, ROUTER, SENDER, 6000000000000000000n),
      ],
    });
    const res = await loadSaleProceeds(HASH);
    expect(res).toEqual({ state: "unrecognised" });
  });
});
