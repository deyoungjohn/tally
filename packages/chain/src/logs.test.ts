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
  await expect(flowChainFromEnv({}).blockNumber()).rejects.toThrow("No configured chain provider");
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
