import { describe, expect, it } from "vitest";
import { LIQUIDMESH_ROUTER } from "@tally/config";
import type { Address } from "@tally/core";
import { readGuardRouter } from "./guard-router";
import type { GuardReading } from "@tally/chain";

const MOCK_STOCK = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as Address;
const MOCK_APPROVE_TARGET = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5" as Address;

describe("readGuardRouter", () => {
  it("queries chain.readGuard with stock and LIQUIDMESH_ROUTER", async () => {
    let queriedStock: Address | null = null;
    let queriedRouter: Address | null = null;

    const mockChain = {
      async readGuard(stock: Address, router: Address): Promise<GuardReading> {
        queriedStock = stock;
        queriedRouter = router;
        return {
          paused: false,
          enabled: true,
          source: 0,
          routerAllowed: true,
          approveTarget: MOCK_APPROVE_TARGET,
          feed: { multiplier: 1000000000000000000n, updatedAt: 1000n, validAfter: 900n },
          maxAge: 3600n,
        };
      },
    };

    const res = await readGuardRouter(mockChain, MOCK_STOCK);
    expect(queriedStock).toBe(MOCK_STOCK);
    expect(queriedRouter).toBe(LIQUIDMESH_ROUTER);
    expect(res).toEqual({
      routerAllowed: true,
      approveTarget: MOCK_APPROVE_TARGET,
    });
  });

  it("propagates chain read error so callers leave hint pending without fallback", async () => {
    const failingChain = {
      async readGuard(): Promise<GuardReading> {
        throw new Error("RPC timeout reading ShareGuard");
      },
    };

    await expect(readGuardRouter(failingChain, MOCK_STOCK)).rejects.toThrow(
      "RPC timeout reading ShareGuard",
    );
  });
});
