import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { statusFromInfo } from "@tally/core";
import { buildTokenStateFromSnapshots, evaluateHoldingRules } from "./evaluator";
import { PausedRule } from "./rules/paused";
import type { RawStatusInfo } from "@tally/core";
import type { UserHolding } from "./types";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("Guardian tests with recorded fixtures", () => {
  const probesFile = join(REPO_ROOT, "packages/binance/fixtures/raw/probes_20261002T052602Z.json");
  const moduleProbesFile = join(REPO_ROOT, "spike/results/module_probes_20261003T130122Z.json");

  const probes = JSON.parse(readFileSync(probesFile, "utf8")) as Record<string, { data: unknown }>;
  const moduleProbes = JSON.parse(readFileSync(moduleProbesFile, "utf8")) as Record<
    string,
    { data: { statusInfo?: RawStatusInfo } }
  >;

  it("verifies 45 MARKET_PAUSED and 133 UNSUPPORTED Ondo tokens in probes_20261002T052602Z.json", () => {
    const tokens = probes.rwa_tokens_plain?.data as Array<{
      underlyingTicker: string;
      tokenSymbol: string;
      statusInfo?: RawStatusInfo;
    }>;
    expect(tokens).toBeDefined();

    const paused = tokens.filter((t) => t.statusInfo?.reasonCode === "MARKET_PAUSED");
    const unsupported = tokens.filter((t) => t.statusInfo?.reasonCode === "UNSUPPORTED");

    expect(paused).toHaveLength(45);
    expect(unsupported).toHaveLength(133);
  });

  it("emits paused alert when a token transitions TRADING -> MARKET_PAUSED from real fixture", () => {
    const tokens = probes.rwa_tokens_plain?.data as Array<{
      underlyingTicker: string;
      tokenContractAddress: string;
      tokenSymbol: string;
      statusInfo: RawStatusInfo;
    }>;

    // Pick one of the 45 paused Ondo tokens from the fixture (e.g. AAPLon or NVDAon if present)
    const fixturePausedToken = tokens.find((t) => t.statusInfo?.reasonCode === "MARKET_PAUSED")!;
    expect(fixturePausedToken).toBeDefined();

    const holding: UserHolding = {
      walletAddress: "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930",
      tokenAddress: fixturePausedToken.tokenContractAddress.toLowerCase(),
      ticker: fixturePausedToken.underlyingTicker,
      issuer: "ondo",
      tokens: 10n * 10n ** 18n,
      shares: 10n * 10n ** 18n,
    };

    const prevStatus = {
      kind: "open" as const,
      reasonCode: "TRADING",
      reasonMsg: null,
      session: "regular" as const,
    };

    const nextStatus = statusFromInfo(fixturePausedToken.statusInfo)!;

    const prevState = buildTokenStateFromSnapshots({
      tokenAddress: holding.tokenAddress,
      ticker: holding.ticker,
      issuer: "ondo",
      observedAt: 1000,
      rawStatus: prevStatus,
    });

    const nextState = buildTokenStateFromSnapshots({
      tokenAddress: holding.tokenAddress,
      ticker: holding.ticker,
      issuer: "ondo",
      observedAt: 2000,
      rawStatus: nextStatus,
    });

    const rule = new PausedRule();
    const alerts = evaluateHoldingRules([rule], prevState, nextState, holding);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule).toBe("paused");
    expect(alerts[0]!.title).toBe(`${holding.ticker} via Ondo is paused`);
    expect(alerts[0]!.body).toContain("is paused: session transition. Your shares are unchanged.");
  });

  it("proves bStock with null marketStatus in module_probes emits nothing from status, but emits from pause port", () => {
    const bstockMarket = moduleProbes.G_underlying_market_NVDAB?.data?.statusInfo;
    expect(bstockMarket).toBeDefined();
    // Prove the probe property: bStock marketStatus is null
    expect(bstockMarket?.marketStatus).toBeNull();
    expect(bstockMarket?.reasonCode).toBe("TRADING");

    const holding: UserHolding = {
      walletAddress: "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930",
      tokenAddress: "0x156d93a3...nvdab",
      ticker: "NVDA",
      issuer: "bstock",
      tokens: 10n * 10n ** 18n,
      shares: 10n * 10n ** 18n,
    };

    const mappedStatus = statusFromInfo(bstockMarket)!;

    const rule = new PausedRule();

    // 1. Without pause port returning true: emits nothing
    const stateNotPaused = buildTokenStateFromSnapshots({
      tokenAddress: holding.tokenAddress,
      ticker: "NVDA",
      issuer: "bstock",
      observedAt: 1000,
      rawStatus: mappedStatus,
      isPausedPort: () => false,
    });
    const alertsWithoutPort = evaluateHoldingRules([rule], null, stateNotPaused, holding);
    expect(alertsWithoutPort).toHaveLength(0);

    // 2. With injected pause port returning true: emits exactly one alert
    const statePaused = buildTokenStateFromSnapshots({
      tokenAddress: holding.tokenAddress,
      ticker: "NVDA",
      issuer: "bstock",
      observedAt: 2000,
      rawStatus: mappedStatus,
      isPausedPort: () => true,
    });
    const alertsWithPort = evaluateHoldingRules([rule], stateNotPaused, statePaused, holding);
    expect(alertsWithPort).toHaveLength(1);
    expect(alertsWithPort[0]!.title).toBe("NVDA via bStock is paused");
    expect(alertsWithPort[0]!.walletAddress).toBe(holding.walletAddress.toLowerCase());
    expect(alertsWithPort[0]!.body).toBe(
      "NVDA via bStock is paused by its pause manager. Your shares are unchanged.",
    );
  });

  it("handles Ondo offhours marketStatus without triggering false pause alerts", () => {
    const ondoMarket = moduleProbes.G_underlying_market_NVDAon?.data?.statusInfo;
    expect(ondoMarket).toBeDefined();
    expect(ondoMarket?.marketStatus).toBe("offhours");
    expect(ondoMarket?.reasonCode).toBe("TRADING");

    const mappedStatus = statusFromInfo(ondoMarket)!;
    expect(mappedStatus.kind).toBe("open"); // TRADING with openState: true is open, session is closed
    expect(mappedStatus.session).toBe("closed");

    const holding: UserHolding = {
      walletAddress: "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930",
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      tokens: 10n * 10n ** 18n,
      shares: 10n * 10n ** 18n,
    };

    const state = buildTokenStateFromSnapshots({
      tokenAddress: holding.tokenAddress,
      ticker: "NVDA",
      issuer: "ondo",
      observedAt: 1000,
      rawStatus: mappedStatus,
    });

    const rule = new PausedRule();
    const alerts = evaluateHoldingRules([rule], null, state, holding);
    expect(alerts).toHaveLength(0);
  });
});
