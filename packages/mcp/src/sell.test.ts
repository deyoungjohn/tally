import { describe, expect, it, vi } from "vitest";
import type { Address } from "@tally/core";
import type { Engine } from "@tally/engine";
import { ToolRegistry } from "./registry";
import { register } from "./tools/sell";

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7" as Address;

describe("MCP sell tool (build_sell_swap)", () => {
  it("registers build_sell_swap tool with ToolRegistry", async () => {
    const registry = new ToolRegistry();
    const mockEngine = {
      trade: {
        prepareSell: vi.fn(),
      },
    } as unknown as Engine;

    await register(registry, mockEngine, { enabled: true });
    const tools = registry.list();
    const sellTool = tools.find((t) => t.name === "build_sell_swap");
    expect(sellTool).toBeDefined();
    expect(sellTool?.description).toContain("unsigned sell swap");
  });

  it("rejects invalid request without required fields", async () => {
    const registry = new ToolRegistry();
    const mockEngine = {
      trade: {
        prepareSell: vi.fn(),
      },
    } as unknown as Engine;

    await register(registry, mockEngine, { enabled: true });
    const res = await registry.call("build_sell_swap", { ticker: "NVDA" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("invalid_request");
  });

  it("calls engine.trade.prepareSell and returns formatted facts", async () => {
    const registry = new ToolRegistry();
    const mockPlan = {
      status: "ready",
      builtAt: 12345,
      expiresAt: 27345,
      ticker: "NVDA",
      issuer: "bstock",
      symbol: "NVDAB",
      stock: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
      tokensIn: "25654736000000000",
      sharesIn: "25674701000000000",
      quotedUsdtOut: "6000000000000000000",
      minUsdtOut: "5940000000000000000",
      multiplier: "1000778223752807865",
      usdPerShare: 233.8,
      routeText: "NVDAB → USDT",
      simulation: { ethCall: "ok" },
    };

    const mockEngine = {
      trade: {
        prepareSell: vi.fn().mockResolvedValue(mockPlan),
      },
    } as unknown as Engine;

    await register(registry, mockEngine, { enabled: true });
    const res = await registry.call("build_sell_swap", {
      ticker: "NVDA",
      issuer: "bstock",
      wallet: USER,
      shares: 0.025,
    });

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.unsigned).toBe(true);
    expect(parsed.signingWallet).toBe(USER);
    expect(parsed.minUsdtFloor).toBe("5.94");
    expect(parsed.factsToShow.ticker).toBe("NVDA");
    expect(parsed.factsToShow.sharesSold).toBe("0.025674701");
  });
});
