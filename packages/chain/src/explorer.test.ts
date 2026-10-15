import { describe, expect, it, vi } from "vitest";
import { createExplorer, parseReceipt } from "./explorer";
import { withExplorerFallback, type Transactions } from "./transactions";

const H = ("0x" + "ab".repeat(32)) as `0x${string}`;
const A = "0x" + "11".repeat(20);
const rec = {
  transactionHash: H,
  from: A,
  to: A,
  blockNumber: "0x10",
  gasUsed: "0x5208",
  effectiveGasPrice: "0x3b9aca00",
  status: "0x1",
  logs: [
    {
      address: A,
      topics: [H],
      data: "0x",
      transactionHash: H,
      blockNumber: "0x10",
      logIndex: "0x2",
    },
  ],
};
const ok = (result: unknown) => ({ json: async () => ({ jsonrpc: "2.0", result }) }) as Response;

describe("explorer", () => {
  it("reads a receipt in the explorer's JSON-RPC shape", () => {
    const r = parseReceipt(rec);
    expect(r).toMatchObject({ blockNumber: 16n, gasUsed: 21000n, status: "success" });
    expect(r.logs[0]).toMatchObject({ logIndex: 2, removed: false });
  });
  it("returns null for an unknown transaction and never puts the key in a warning", async () => {
    const warn = vi.fn();
    const fetchMock = vi.fn().mockRejectedValue(new Error("https://x?apikey=SECRETKEY"));
    const ex = createExplorer({ key: "SECRETKEY", fetch: fetchMock, onWarn: warn });
    expect(await ex.receipt(H)).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRETKEY");
  });
  it("stops at the daily budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(null));
    const ex = createExplorer({
      key: "k",
      fetch: fetchMock,
      perDay: 2,
      perSecond: 1000,
      onWarn: () => {},
    });
    await ex.receipt(H);
    await ex.receipt(H);
    await ex.receipt(H);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("withExplorerFallback", () => {
  const miss: Transactions = { getTransaction: async () => null, getReceipt: async () => null };
  const explorer = (r: unknown) => ({
    receipt: async () => (r ? parseReceipt(r as Record<string, unknown>) : null),
    transaction: async () => null,
  });
  it("uses the explorer when the RPC has not seen the transaction", async () => {
    const t = withExplorerFallback(miss, explorer(rec));
    expect((await t.getReceipt(H))?.gasUsed).toBe(21000n);
  });
  it("uses the explorer when the RPC is slow, and the RPC's own answer when it is not", async () => {
    const slowRpc: Transactions = {
      ...miss,
      getReceipt: () => new Promise((r) => setTimeout(() => r(null), 200)),
    };
    const t = withExplorerFallback(slowRpc, explorer(rec), 20);
    expect((await t.getReceipt(H))?.status).toBe("success");
    const fast: Transactions = {
      ...miss,
      getReceipt: async () => ({ ...parseReceiptRead(), gasUsed: 1n }),
    };
    expect((await withExplorerFallback(fast, explorer(rec)).getReceipt(H))?.gasUsed).toBe(1n);
  });
  it("is still null when neither knows it", async () => {
    expect(await withExplorerFallback(miss, explorer(null)).getReceipt(H)).toBeNull();
  });
  it("passes the RPC through untouched when there is no explorer", async () => {
    expect(withExplorerFallback(miss, null)).toBe(miss);
  });
});

function parseReceiptRead() {
  const r = parseReceipt(rec);
  return {
    hash: r.transactionHash,
    sender: r.from,
    destination: r.to,
    blockNumber: r.blockNumber,
    gasUsed: r.gasUsed,
    status: r.status,
    logs: r.logs,
  };
}
