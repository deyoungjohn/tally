import { createPublicClient, custom, type PublicClient } from "viem";
import { expect, it, vi } from "vitest";
import { flowChainFromClients, flowChainFromEnv } from "./logs";

it("logs reader rejects more than 10000 inclusive blocks before any RPC call", async () => {
  const request = vi.fn(async () => "0x1");
  const client = createPublicClient({ transport: custom({ request }) });
  const chain = flowChainFromClients([client as PublicClient]);
  await expect(chain.transferLogs("0x" + "1".repeat(40), 0n, 10000n)).rejects.toThrow("1..10000");
  await expect(chain.transferLogs("0x" + "1".repeat(40), 2n, 1n)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("ordered chain failover warns without exposing provider errors, and all failures stay sanitized", async () => {
  const dead = createPublicClient({
    transport: custom(
      {
        request: async () => {
          throw new Error("provider credential must not appear");
        },
      },
      { retryCount: 0 },
    ),
  });
  const request = vi.fn(async () => "0x42");
  const live = createPublicClient({ transport: custom({ request }) });
  const warn = vi.fn(),
    chain = flowChainFromClients([dead, live] as PublicClient[], warn);
  expect(await chain.blockNumber()).toBe(66n);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls.flat().join(" ")).not.toContain("credential");
  await expect(flowChainFromClients([dead] as PublicClient[], warn).blockNumber()).rejects.toThrow(
    "No configured chain provider",
  );
  const unconfigured = vi.fn();
  const empty = flowChainFromEnv({}, unconfigured);
  expect(unconfigured).toHaveBeenCalledTimes(1);
  expect(unconfigured).toHaveBeenCalledWith(
    "Flow chain reader has no configured provider; chain fallback unavailable",
  );
  await expect(empty.blockNumber()).rejects.toThrow("No configured chain provider");
  expect(unconfigured).toHaveBeenCalledTimes(1);
});
it("uses engine RPC aliases in order and only the first configured fallback", async () => {
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const { id } = JSON.parse(init.body as string) as { id: number };
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        ...(url.includes("primary")
          ? { error: { code: -32000, message: "offline" } }
          : { result: "0x42" }),
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", request);
  try {
    const warn = vi.fn();
    expect(
      await flowChainFromEnv(
        {
          BSC_RPC_PRIMARY: "https://primary.invalid",
          BSC_RPC_FALLBACKS: " https://backup.invalid ,https://unused.invalid",
        },
        warn,
      ).blockNumber(),
    ).toBe(66n);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://primary.invalid/",
      "https://backup.invalid/",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("https://");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("explicit NodeReal and Ankr settings take precedence over engine aliases", async () => {
  const request = vi.fn(async (url: string, init: RequestInit) => {
    const { id } = JSON.parse(init.body as string) as { id: number };
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        ...(url.includes("node")
          ? { error: { code: -32000, message: "offline" } }
          : { result: "0x7" }),
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", request);
  try {
    expect(
      await flowChainFromEnv(
        {
          BSC_RPC_NODEREAL: "https://node.invalid",
          BSC_RPC_ANKR: "https://ankr.invalid",
          BSC_RPC_PRIMARY: "https://unused-primary.invalid",
          BSC_RPC_FALLBACKS: "https://unused-backup.invalid",
        },
        vi.fn(),
      ).blockNumber(),
    ).toBe(7n);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://node.invalid/",
      "https://ankr.invalid/",
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("a successful primary needs no backup", async () => {
  const primary = createPublicClient({ transport: custom({ request: async () => "0x1" }) });
  const request = vi.fn(async () => "0x2");
  const backup = createPublicClient({ transport: custom({ request }) });
  expect(await flowChainFromClients([primary, backup] as PublicClient[]).blockNumber()).toBe(1n);
  expect(request).not.toHaveBeenCalled();
});

it("raw recorded logs retain NodeReal timestamps and send a Transfer-only 10000-block query", async () => {
  const { readFileSync } = await import("node:fs");
  const evidence = JSON.parse(
    readFileSync(
      new URL("../../../spike/results/module_probes_20261003T130122Z.json", import.meta.url),
      "utf8",
    ),
  ) as {
    F_logs: {
      providers: {
        BSC_RPC_NODEREAL: {
          head: number;
          sample: { blockNumber: string; blockTimestamp: string }[];
        };
      };
    };
  };
  const recorded = evidence.F_logs.providers.BSC_RPC_NODEREAL;
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method !== "eth_getLogs") throw new Error("Unexpected header request");
    return recorded.sample;
  });
  const client = createPublicClient({ transport: custom({ request }) });
  const chain = flowChainFromClients([client as PublicClient]);
  const logs = await chain.transferLogs(
    "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    BigInt(recorded.head) - 9999n,
    BigInt(recorded.head),
  );
  expect(logs).toHaveLength(2);
  expect(logs[0]!.timestampMs).toBe(Number(BigInt(recorded.sample[0]!.blockTimestamp)) * 1000);
  expect(logs[0]!.blockNumber).toBe(BigInt(recorded.sample[0]!.blockNumber));
  expect(request).toHaveBeenCalledTimes(1);
});

const TOKEN = "0x" + "1".repeat(40);
const WALLET = "0x" + "a".repeat(40);
const topic = (a: string) => "0x" + a.slice(2).padStart(64, "0");
it("incomingTransfers filters by indexed recipient, halves the span on refusal and sorts newest first", async () => {
  const seen: { from: string; to: string; topics: unknown[] }[] = [];
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method !== "eth_getLogs") throw new Error("unexpected");
    const f = (params as { fromBlock: string; toBlock: string; topics: unknown[] }[])[0]!;
    seen.push({ from: f.fromBlock, to: f.toBlock, topics: f.topics });
    if (BigInt(f.toBlock) - BigInt(f.fromBlock) + 1n > 100_000n) throw new Error("range too large");
    return [
      {
        address: TOKEN,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          topic("0x" + "b".repeat(40)),
          topic(WALLET),
        ],
        data: "0x" + (5n * 10n ** 18n).toString(16),
        blockNumber: f.toBlock,
        transactionHash: "0x" + "c".repeat(64),
        logIndex: "0x1",
        blockTimestamp: "0x64",
        removed: false,
      },
    ];
  });
  const client = createPublicClient({ transport: custom({ request }) });
  const chain = flowChainFromClients([client as PublicClient], vi.fn());
  const r = await chain.incomingTransfers(TOKEN, WALLET, 0n, 1_000_000n);
  expect(r.complete).toBe(true);
  expect(r.transfers.length).toBeGreaterThan(3);
  expect(r.transfers[0]!.blockNumber).toBeGreaterThan(r.transfers.at(-1)!.blockNumber);
  expect(r.transfers[0]!.amount).toBe(5n * 10n ** 18n);
  expect(r.transfers[0]!.from).toBe("0x" + "b".repeat(40));
  expect(seen.at(-1)!.topics[2]).toBe(topic(WALLET));
  await expect(chain.incomingTransfers(TOKEN, "0x1", 0n, 1n)).rejects.toThrow("Invalid address");
  await expect(chain.incomingTransfers(TOKEN, WALLET, 0n, 3_000_000n)).rejects.toThrow(RangeError);
});
it("incomingTransfers reports an incomplete scan when the provider refuses every span", async () => {
  const dead = createPublicClient({
    transport: custom(
      {
        request: async () => {
          throw new Error("nope");
        },
      },
      { retryCount: 0 },
    ),
  });
  const chain = flowChainFromClients([dead as PublicClient], vi.fn());
  const r = await chain.incomingTransfers(TOKEN, WALLET, 0n, 1_000_000n);
  expect(r).toEqual({ transfers: [], complete: false });
});
