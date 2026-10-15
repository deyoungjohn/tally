import { createPublicClient, custom, encodeAbiParameters, type Hex } from "viem";
import { bsc } from "viem/chains";
import { describe, expect, it } from "vitest";
import { liveTradeChain } from "./trade-chain";

const GUARD = "0x28F6F19bffbF25E36452c78d12090F0bC922970a";
const OWNER = "0x1111111111111111111111111111111111111111";

/** Answers every eth_call as a multicall3 aggregate3 result with a zero balance per call, and counts the calls. */
function stubClient() {
  const calls: number[] = [];
  const client = createPublicClient({
    chain: bsc,
    transport: custom({
      async request({ method, params }: { method: string; params?: unknown }) {
        if (method === "eth_chainId") return "0x38";
        if (method !== "eth_call") throw new Error(`unexpected ${method}`);
        const data = (params as [{ data: Hex }])[0].data;
        // aggregate3((address,bool,bytes)[]): the count is the array length word.
        const n = Number(BigInt(`0x${data.slice(10 + 64, 10 + 128)}`));
        calls.push(n);
        const result = encodeAbiParameters(
          [
            {
              type: "tuple[]",
              components: [
                { name: "success", type: "bool" },
                { name: "returnData", type: "bytes" },
              ],
            },
          ],
          [
            Array.from({ length: n }, () => ({
              success: true,
              returnData: `0x${"0".repeat(64)}` as Hex,
            })),
          ],
        );
        return result;
      },
    }),
  });
  return { client, calls };
}

describe("erc20Balances", () => {
  it("reads a 100-token chunk in one provider call, not one per few tokens", async () => {
    const { client, calls } = stubClient();
    const chain = liveTradeChain(client as never, GUARD);
    const tokens = Array.from(
      { length: 100 },
      (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    );
    const res = await chain.erc20Balances(OWNER, tokens);
    expect(res).toHaveLength(100);
    expect(calls).toEqual([100]);
  });
});
