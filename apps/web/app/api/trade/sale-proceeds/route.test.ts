import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

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

vi.mock("../../../../lib/server/engine", () => ({
  getEngine: async () => mockEngine,
}));

vi.mock("@tally/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tally/config")>();
  return {
    ...actual,
    USDT_BSC: "0x55d398326f99059fF775485246999027B3197955",
    flags: () => ({
      switch: process.env.TEST_FEATURE_SWITCH !== "0",
    }),
  };
});

import { GET } from "./route";

describe("GET /api/trade/sale-proceeds", () => {
  const USDT = "0x55d398326f99059fF775485246999027B3197955".toLowerCase();
  const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436".toLowerCase();
  const NVDAon = "0x4560000000000000000000000000000000000000".toLowerCase();
  const SENDER = "0x1230000000000000000000000000000000000000".toLowerCase();
  const ROUTER = "0x9990000000000000000000000000000000000000".toLowerCase();
  const VALID_HASH = "0x" + "a".repeat(64);

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
    delete process.env.TEST_FEATURE_SWITCH;
    mockEngine.ports.registry.all.mockResolvedValue([
      { address: NVDAB, ticker: "NVDA", issuer: "bstock" },
      { address: NVDAon, ticker: "NVDA", issuer: "ondo" },
    ]);
  });

  it("returns 404 when switch flag is off", async () => {
    process.env.TEST_FEATURE_SWITCH = "0";
    const req = new NextRequest(`http://localhost/api/trade/sale-proceeds?hash=${VALID_HASH}`);
    const res = await GET(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error.kind).toBe("not_found");
  });

  it("returns 400 on invalid or malformed hash", async () => {
    const req = new NextRequest("http://localhost/api/trade/sale-proceeds?hash=invalid");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 503 on RPC failure", async () => {
    mockEngine.transactions.getReceipt.mockRejectedValue(new Error("RPC node timeout"));
    const req = new NextRequest(`http://localhost/api/trade/sale-proceeds?hash=${VALID_HASH}`);
    const res = await GET(req);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error.kind).toBe("rpc_failure");
  });

  it("returns pending if receipt is null/unmined", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue(null);
    const req = new NextRequest(`http://localhost/api/trade/sale-proceeds?hash=${VALID_HASH}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ state: "pending" });
  });

  it("returns failed if transaction reverted", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "reverted",
      sender: SENDER,
      blockNumber: 100n,
      logs: [],
    });
    const req = new NextRequest(`http://localhost/api/trade/sale-proceeds?hash=${VALID_HASH}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ state: "failed" });
  });

  it("returns confirmed with raw amounts, stock token and block number for a valid sale", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 12345n,
      logs: [
        makeTransferLog(NVDAB, SENDER, ROUTER, 10000000000000000n),
        makeTransferLog(USDT, ROUTER, SENDER, 6500000000000000000n),
      ],
    });
    const req = new NextRequest(`http://localhost/api/trade/sale-proceeds?hash=${VALID_HASH}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      state: "confirmed",
      usdtReceivedRaw: "6500000000000000000",
      tokensSpentRaw: "10000000000000000",
      stockToken: NVDAB,
      blockNumber: 12345,
    });
  });

  it("returns unrecognised when logs do not contain USDT transfer to sender", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 12345n,
      logs: [
        makeTransferLog(NVDAB, SENDER, ROUTER, 10000000000000000n),
        // No USDT transfer to SENDER
      ],
    });
    const req = new NextRequest(`http://localhost/api/trade/sale-proceeds?hash=${VALID_HASH}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ state: "unrecognised" });
  });

  it("returns unrecognised when logs contain transfers for two different stock tokens", async () => {
    mockEngine.transactions.getReceipt.mockResolvedValue({
      status: "success",
      sender: SENDER,
      blockNumber: 12345n,
      logs: [
        makeTransferLog(NVDAB, SENDER, ROUTER, 5000n),
        makeTransferLog(NVDAon, SENDER, ROUTER, 5000n),
        makeTransferLog(USDT, ROUTER, SENDER, 6500000000000000000n),
      ],
    });
    const req = new NextRequest(`http://localhost/api/trade/sale-proceeds?hash=${VALID_HASH}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ state: "unrecognised" });
  });
});
