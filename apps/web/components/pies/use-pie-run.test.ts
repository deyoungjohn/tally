import { expect, it, vi } from "vitest";
import type { PlanDto, ReceiptDto } from "@/lib/dto";
import {
  createPieRunner,
  type PieRunTransport,
  type PieRunInput,
  type PieBuyRun,
} from "./use-pie-run-driver";
import { PENDING_PIE_KEY, PIE_RUN_TTL_MS } from "./use-pie-run-state";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;
const STOCK = "0x3333333333333333333333333333333333333333";
const GUARD = "0x4444444444444444444444444444444444444444";
const HASH = `0x${"b2".padStart(64, "0")}` as const;
const APPROVE = `0x${"a1".padStart(64, "0")}` as const;
const input: PieRunInput = {
  templateId: "big-tech",
  budgetUsdt: "18000000000000000000",
  legs: ["NVDA", "AAPL", "GOOGL"].map((ticker, index) => ({
    id: `leg-${index}`,
    sequence: index + 1,
    ticker,
    issuer: "bstock",
    symbol: `${ticker}B`,
    amountUsdt: "6000000000000000000",
    executable: true,
    reason: null,
  })),
};
function fixture() {
  let now = 1_800_000_000_000;
  let address: `0x${string}` = WALLET;
  let enabled = true;
  const values = new Map<string, string>();
  const publications: (PieBuyRun | null)[] = [];
  const sendTx = vi.fn(async () => HASH);
  const io: PieRunTransport = {
    wallet: () => ({ ready: true, authenticated: true, address, sendTx }),
    enabled: () => enabled,
    tokenEnabled: () => true,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    },
    plan: vi.fn(async (params): Promise<PlanDto> => ({
      status: "ready",
      ticker: params.ticker,
      issuer: "bstock",
      symbol: params.symbol,
      builtAt: now,
      expiresAt: now + 15000,
      stock: STOCK,
      guard: GUARD,
      tolerancePct: 1,
      amountInUsdt: "6000000000000000000",
      tokensOut: "1",
      quotedShares: "1",
      minShares: "1",
      multiplier: "1000000000000000000",
      usdPerShare: 6,
      referencePrice: 6,
      premium: 0,
      routeText: "constructed",
      hops: 1,
      vendor: "fixture",
      feedUpdate: false,
      balances: { usdt: "18000000000000000000", bnb: "1000000000000000" },
      warnings: [],
      tx: {
        to: GUARD,
        data: "0x1234",
        value: "0x0",
        gasEstimate: "400000",
        gasLimit: "500000",
        gasPriceWei: "1",
        feeUsd: 0.01,
        deadline: Math.floor(now / 1000) + 300,
        chainId: 56,
      },
    })),
    receipt: vi.fn(async (hash): Promise<ReceiptDto> => ({
      status: "success",
      txHash: hash,
      bscscan: `https://bscscan.com/tx/${hash}`,
    })),
    txStatus: vi.fn(async () => ({ status: "success" as const })),
    now: () => now,
    sleep: async () => {
      now += 3000;
    },
    id: () => "constructed-run",
    changed: vi.fn(),
    onWarn: vi.fn(),
  };
  const create = () => createPieRunner(io, (run) => publications.push(run));
  return {
    io,
    sendTx,
    values,
    publications,
    create,
    setWallet: (value: `0x${string}`) => {
      address = value;
    },
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
it("fetches a fresh matching plan per leg and signs exactly its transaction, sequentially", async () => {
  const f = fixture();
  const runner = f.create();
  await runner.start(input);
  expect(vi.mocked(f.io.plan).mock.calls.map(([params]) => params.ticker)).toEqual([
    "NVDA",
    "AAPL",
    "GOOGL",
  ]);
  expect(f.sendTx).toHaveBeenCalledTimes(3);
  for (const [tx] of f.sendTx.mock.calls as unknown as [
    { to: string; data: string; gas: bigint; value: bigint },
  ][]) {
    expect(tx).toEqual({ to: GUARD, data: "0x1234", gas: 500000n, value: 0n });
  }
  expect(runner.run?.status).toBe("done");
  expect(runner.run?.legs.map((leg) => [leg.status, leg.txHash])).toEqual(
    Array(3).fill(["done", HASH]),
  );
});
it("waits for exact approval, replans, then buys; it never reuses the approval quote", async () => {
  const f = fixture();
  const ready = f.io.plan;
  f.io.plan = vi.fn(async (params, wallet): Promise<PlanDto> => {
    const plan = await ready(params, wallet);
    return vi.mocked(f.io.plan).mock.calls.length === 1
      ? {
          ...plan,
          status: "needs_approval",
          tx: undefined,
          approve: { to: STOCK, data: "0x095ea7b3", amount: plan.amountInUsdt },
        }
      : plan;
  });
  f.sendTx.mockResolvedValueOnce(APPROVE);
  const runner = f.create();
  await runner.start({ ...input, legs: input.legs.slice(0, 1) });
  expect(f.io.plan).toHaveBeenCalledTimes(2);
  expect(f.io.receipt).toHaveBeenNthCalledWith(1, APPROVE, "NVDA", "NVDAB");
  expect(f.sendTx.mock.calls[0]).toEqual([
    { to: STOCK, data: "0x095ea7b3", gas: 80000n, value: 0n },
  ]);
  expect(runner.run?.legs[0]).toMatchObject({
    status: "done",
    approvalHash: APPROVE,
    txHash: HASH,
  });
});
it("stops at the second failure with exact states and only retries on explicit Continue", async () => {
  const f = fixture();
  const ready = f.io.plan;
  let fail = true;
  f.io.plan = vi.fn(async (params, wallet): Promise<PlanDto> => {
    if (params.ticker === "AAPL" && fail)
      throw Object.assign(new Error("No route for this leg"), { kind: "route_failed" });
    return ready(params, wallet);
  });
  const runner = f.create();
  await runner.start(input);
  expect(runner.run?.legs.map((leg) => leg.status)).toEqual(["done", "failed", "not_started"]);
  expect(runner.run?.legs[1]?.reason).toBe("No route for this leg");
  expect(f.sendTx).toHaveBeenCalledTimes(1);
  fail = false;
  await runner.continueRemaining();
  expect(f.sendTx).toHaveBeenCalledTimes(3);
  expect(vi.mocked(f.io.plan).mock.calls.map(([params]) => params.ticker)).toEqual([
    "NVDA",
    "AAPL",
    "AAPL",
    "GOOGL",
  ]);
});
it("reload checks a saved signed transaction and never signs that leg again", async () => {
  const f = fixture();
  const original = f.create();
  await original.start(input);
  const saved = original.run!;
  saved.status = "running";
  saved.legs[1] = { ...saved.legs[1]!, status: "pending", pendingTx: { kind: "buy", hash: HASH } };
  saved.legs[2] = { ...saved.legs[2]!, status: "not_started", txHash: undefined };
  f.values.set(PENDING_PIE_KEY, JSON.stringify(saved));
  f.sendTx.mockClear();
  vi.mocked(f.io.plan).mockClear();
  const resumed = f.create();
  await resumed.restore();
  expect(f.io.txStatus).toHaveBeenCalledWith(HASH);
  expect(f.sendTx).not.toHaveBeenCalled();
  expect(f.io.plan).not.toHaveBeenCalled();
  expect(resumed.run?.legs.map((leg) => leg.status)).toEqual(["done", "done", "not_started"]);
  await resumed.continueRemaining();
  expect(f.sendTx).toHaveBeenCalledTimes(1);
  expect(vi.mocked(f.io.plan).mock.calls[0]?.[0].ticker).toBe("GOOGL");
});
it("another wallet ignores/removes the saved run, and a 24-hour run expires", async () => {
  const f = fixture();
  const runner = f.create();
  await runner.start(input);
  const raw = f.values.get(PENDING_PIE_KEY)!;
  f.setWallet(OTHER);
  const other = f.create();
  await other.restore();
  expect(other.run).toBeNull();
  expect(f.values.has(PENDING_PIE_KEY)).toBe(false);
  f.setWallet(WALLET);
  f.values.set(PENDING_PIE_KEY, raw);
  f.advance(PIE_RUN_TTL_MS);
  await f.create().restore();
  expect(f.values.has(PENDING_PIE_KEY)).toBe(false);
});
it("does not duplicate a pending buy after timeout or resume while it is unconfirmed", async () => {
  const f = fixture();
  f.io.receipt = vi.fn(async (hash): Promise<ReceiptDto> => ({
    status: "pending",
    txHash: hash,
    bscscan: "fixture",
  }));
  const runner = f.create();
  await runner.start({ ...input, legs: input.legs.slice(0, 1) });
  expect(runner.run?.status).toBe("failed");
  expect(runner.run?.legs[0]?.pendingTx?.hash).toBe(HASH);
  f.io.txStatus = vi.fn(async () => ({ status: "pending" as const }));
  await runner.continueRemaining();
  expect(f.sendTx).toHaveBeenCalledTimes(1);
});
it("interrupted signing without a hash blocks another signature after reload", async () => {
  const f = fixture();
  const runner = f.create();
  await runner.start(input);
  const saved = runner.run!;
  saved.status = "running";
  saved.legs[0] = {
    ...saved.legs[0]!,
    status: "signing",
    txHash: undefined,
    signatureUncertain: true,
  };
  f.values.set(PENDING_PIE_KEY, JSON.stringify(saved));
  f.sendTx.mockClear();
  const resumed = f.create();
  await resumed.restore();
  await resumed.continueRemaining();
  expect(resumed.run?.legs[0]?.reason).toContain("hash");
  expect(f.sendTx).not.toHaveBeenCalled();
});
it("feature-off and unavailable-issuer data prevent signatures", async () => {
  const f = fixture();
  f.setEnabled(false);
  await expect(f.create().start(input)).rejects.toThrow("Pies is not enabled");
  f.setEnabled(true);
  f.io.tokenEnabled = () => false;
  const runner = f.create();
  await runner.start(input);
  expect(runner.run?.legs[0]?.reason).toBe("NVDAB isn’t enabled in Tally yet");
  expect(f.sendTx).not.toHaveBeenCalled();
});
it("does not sign after the wallet changes while fetching a plan", async () => {
  const f = fixture();
  const ready = f.io.plan;
  f.io.plan = async (params, user) => {
    const result = await ready(params, user);
    f.setWallet(OTHER);
    return result;
  };
  await f.create().start(input);
  expect(f.sendTx).not.toHaveBeenCalled();
});
it("malformed/over-budget inputs and unavailable persistence cannot reach the wallet", async () => {
  const f = fixture();
  await expect(f.create().start({ ...input, budgetUsdt: "1" })).rejects.toThrow(/budget/);
  f.io.storage.setItem = () => {
    throw new Error("Storage blocked");
  };
  await expect(f.create().start(input)).rejects.toThrow("Storage blocked");
  expect(f.sendTx).not.toHaveBeenCalled();
});
it("a hash returned after unmount is saved without overwriting another coordinator", async () => {
  const f = fixture();
  let resolve!: (hash: typeof HASH) => void;
  f.sendTx.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const runner = f.create();
  const active = runner.start(input);
  await vi.waitFor(() => expect(f.sendTx).toHaveBeenCalledTimes(1));
  runner.dispose();
  resolve(HASH);
  await active;
  const saved = JSON.parse(f.values.get(PENDING_PIE_KEY)!);
  expect(saved.legs[0].pendingTx.hash).toBe(HASH);
  expect(saved.legs[1].status).toBe("not_started");
  const resumed = f.create();
  await resumed.restore();
  expect(resumed.run?.legs[0]?.status).toBe("done");
  expect(f.sendTx).toHaveBeenCalledTimes(1);
});
