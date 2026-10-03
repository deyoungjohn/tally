import { expect, it } from "vitest";
import { createFixtureEngine } from "./engine";

it("engine.collectors exposes recorded registry/status and batch prices without changing quote behavior", async () => {
  const engine = createFixtureEngine();
  const registry = await engine.collectors.registry();
  const addresses = registry
    .filter((r) => ["NVDAB", "NVDAon"].includes(r.tokenSymbol))
    .map((r) => r.tokenContractAddress);
  expect(addresses).toHaveLength(2);
  const prices = await engine.collectors.prices(addresses);
  expect(prices).toHaveLength(2);
  expect(prices.find((r) => r.platformId === "bstock")?.tokenPrice).toBe("234.26000000");
  const quote = await engine.quote({ ticker: "NVDA", amount: { usd: 25 } });
  expect(quote.rows.find((r) => r.symbol === "NVDAon")?.sharesOut).toBeGreaterThan(0n);
  expect(quote.session).toBe("overnight");
});
