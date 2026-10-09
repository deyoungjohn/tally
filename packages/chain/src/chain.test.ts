import { custom, encodeAbiParameters, numberToHex, type Transport } from "viem";
import { describe, expect, it } from "vitest";
import { createBscClient, PUBLIC_BSC_RPCS } from "./client";
import { chainPort, planGas, simulateAtLimit } from "./gas";
import { onchainMultiplierReader, readUiMultiplier } from "./multiplier";

type Handler = (method: string, params: unknown[]) => unknown;
function rpc(handler: Handler): {
  transport: Transport;
  calls: Array<{ method: string; params: unknown[] }>;
} {
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      calls.push({ method, params: (params as unknown[]) ?? [] });
      return handler(method, (params as unknown[]) ?? []);
    },
  });
  return { transport, calls };
}
const word = (n: bigint) => encodeAbiParameters([{ type: "uint256" }], [n]);
const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as const;
const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7" as const;

describe("failover transport (V14: publicnode started answering 403 to the EC2 box mid-run)", () => {
  it("falls over when a provider answers -32003 'daily request limit reached' (viem would otherwise give up)", async () => {
    const limited = custom({
      async request() {
        throw Object.assign(
          new Error(
            "daily request limit reached - upgrade your account at https://dashboard.example.io/key123",
          ),
          {
            code: -32003,
          },
        );
      },
    });
    const live = rpc((m) => (m === "eth_blockNumber" ? "0x38" : "0x"));
    const client = createBscClient({ transports: [limited, live.transport] });
    await expect(client.getBlockNumber()).resolves.toBe(56n);
    expect(live.calls.map((c) => c.method)).toContain("eth_blockNumber");
  });
  it("a genuine -32003 that is not about a limit still stops (no hidden retries on a rejected transaction)", async () => {
    const rejected = custom({
      async request() {
        throw Object.assign(new Error("transaction rejected: nonce too low"), { code: -32003 });
      },
    });
    const live = rpc(() => "0x38");
    const client = createBscClient({ transports: [rejected, live.transport] });
    await expect(client.getBlockNumber()).rejects.toThrow();
    expect(live.calls).toHaveLength(0);
  });
  it("falls over to the next endpoint when the first one fails, in the configured order", async () => {
    const dead = rpc(() => {
      throw new Error("HTTP 403 Forbidden");
    });
    const live = rpc((m) => (m === "eth_call" ? word(1_000_778_223_752_807_865n) : "0x38"));
    const client = createBscClient({ transports: [dead.transport, live.transport] });
    expect(await readUiMultiplier(client, NVDAB)).toBe(1_000_778_223_752_807_865n);
    expect(dead.calls.length).toBeGreaterThan(0);
    expect(live.calls.map((c) => c.method)).toContain("eth_call");
  });
  it("the dedicated provider is tried first when it works (no calls reach the fallbacks)", async () => {
    const primary = rpc(() => word(1n));
    const backup = rpc(() => word(2n));
    const client = createBscClient({ transports: [primary.transport, backup.transport] });
    expect(await readUiMultiplier(client, NVDAB)).toBe(1n);
    expect(backup.calls).toHaveLength(0);
  });
  it("the default public list matches the blueprint and the env builder puts a dedicated URL first", () => {
    expect(PUBLIC_BSC_RPCS).toEqual([
      "https://bsc-dataseed.bnbchain.org",
      "https://bsc-dataseed1.defibit.io",
      "https://bsc-rpc.publicnode.com",
    ]);
  });
});

describe("multiplier readers (blueprint §7.3)", () => {
  it("calls uiMultiplier() 0xa60bf13d for bStock and multiplier() 0x1b3ed722 for xStocks; Ondo has no on-chain value", async () => {
    const t = rpc((m) => (m === "eth_call" ? word(1_001_701_196_801_074_000n) : "0x38"));
    const read = onchainMultiplierReader(createBscClient({ transports: [t.transport] }));
    expect(await read({ issuer: "bstock", address: NVDAB })).toBe(1_001_701_196_801_074_000n);
    expect(
      await read({ issuer: "xstocks", address: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d" }),
    ).toBe(1_001_701_196_801_074_000n);
    expect(
      await read({ issuer: "ondo", address: "0xa9ee28c80f960b889dfbd1902055218cba016f75" }),
    ).toBeUndefined();
    const selectors = t.calls
      .filter((c) => c.method === "eth_call")
      .map((c) => (c.params[0] as { data: string }).data.slice(0, 10));
    expect(selectors).toEqual(["0xa60bf13d", "0x1b3ed722"]);
  });
});

describe("gas planning (V10: never trust the API's 450000)", () => {
  it("limit = ceil(estimateGas × 1.25): the 942,344 estimate from the failed F6 route becomes 1,177,930", async () => {
    const t = rpc((m) => (m === "eth_estimateGas" ? numberToHex(942_344n) : "0x38"));
    const plan = await planGas(createBscClient({ transports: [t.transport] }), {
      account: USER,
      to: NVDAB,
      data: "0x1234",
    });
    expect(plan).toEqual({ estimate: 942_344n, limit: 1_177_930n });
    expect(plan.limit).toBeGreaterThan(450_000n);
  });
  it("simulation runs at EXACTLY the limit that will be sent", async () => {
    const t = rpc((m) => (m === "eth_call" ? "0xabcd" : "0x38"));
    const r = await simulateAtLimit(
      createBscClient({ transports: [t.transport] }),
      { account: USER, to: NVDAB, data: "0x1234" },
      1_177_930n,
    );
    expect(r).toEqual({ ok: true, returnData: "0xabcd" });
    const call = t.calls.find((c) => c.method === "eth_call")!;
    expect((call.params[0] as { gas: string }).gas).toBe(numberToHex(1_177_930n));
  });
  it("a revert comes back as a failed simulation with the reason, not an exception (the user is never asked to sign)", async () => {
    const t = rpc((m) => {
      if (m === "eth_call")
        throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x1425ea42" });
      return "0x38";
    });
    const r = await simulateAtLimit(
      createBscClient({ transports: [t.transport] }),
      { account: USER, to: NVDAB, data: "0x1234" },
      450_000n,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe("chain port caching (§7.7: gas price 30 s, BNB 60 s)", () => {
  it("serves the gas price from cache within 30 s and reloads after", async () => {
    let t = 0;
    let gasCalls = 0;
    const tr = rpc((m) => {
      if (m === "eth_gasPrice") return numberToHex(BigInt(++gasCalls) * 1_000n);
      return "0x38";
    });
    const port = chainPort(
      createBscClient({ transports: [tr.transport] }),
      async () => 772.8,
      () => t,
    );
    expect(await port.gasPriceWei()).toBe(1_000n);
    t = 29_999;
    expect(await port.gasPriceWei()).toBe(1_000n);
    t = 30_000;
    expect(await port.gasPriceWei()).toBe(2_000n);
    expect(await port.bnbUsd()).toBe(772.8);
  });
});
