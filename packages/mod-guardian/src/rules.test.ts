import { describe, expect, it } from "vitest";
import { PausedRule } from "./rules/paused";
import { ShareCountRule } from "./rules/share-count";
import { GradeDropRule } from "./rules/grade-drop";
import { GhostRule } from "./rules/ghost";
import { PriceThresholdRule } from "./rules/price-threshold";
import { EarningsRule } from "./rules/earnings";
import type { TokenState, UserHolding } from "./types";

const mockHoldingOndo: UserHolding = {
  walletAddress: "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930",
  tokenAddress: "0xnvdaonaddress",
  ticker: "NVDA",
  issuer: "ondo",
  tokens: 10n * 10n ** 18n,
  shares: 10n * 10n ** 18n,
};

const mockHoldingBstock: UserHolding = {
  walletAddress: "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930",
  tokenAddress: "0xnvdabaddress",
  ticker: "NVDA",
  issuer: "bstock",
  tokens: 10n * 10n ** 18n,
  shares: 10n * 10n ** 18n,
};

describe("PausedRule", () => {
  const rule = new PausedRule();

  it("emits an alert when Ondo token transitions TRADING -> MARKET_PAUSED", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: {
        kind: "open",
        reasonCode: "TRADING",
        reasonMsg: null,
        session: "regular",
      },
      multiplier: 1001715000000000000n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      status: {
        kind: "paused",
        reasonCode: "MARKET_PAUSED",
        reasonMsg: "Paused for session transition",
        session: "closed",
      },
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule).toBe("paused");
    expect(alerts[0]!.walletAddress).toBe(mockHoldingOndo.walletAddress.toLowerCase());
    expect(alerts[0]!.title).toBe("NVDA via Ondo is paused");
    expect(alerts[0]!.body).toBe(
      "NVDA via Ondo is paused: session transition. Your shares are unchanged.",
    );
    expect(alerts[0]!.severity).toBe("warning");
    expect(alerts[0]!.evidence.snapshotKind).toBe("rwa:status");
  });

  it("does not re-alert on repeated polls when already paused", () => {
    const state: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: {
        kind: "paused",
        reasonCode: "MARKET_PAUSED",
        reasonMsg: "Paused for session transition",
        session: "closed",
      },
      multiplier: 1001715000000000000n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 230,
      session: "closed",
      observedAt: 2000,
      isPausedOnchain: null,
    };

    const alerts = rule.evaluate(state, { ...state, observedAt: 3000 }, mockHoldingOndo);
    expect(alerts).toHaveLength(0);
  });

  it("emits nothing from status for bStock when status marketStatus is null", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdabaddress",
      ticker: "NVDA",
      issuer: "bstock",
      status: {
        kind: "open",
        reasonCode: "TRADING",
        reasonMsg: null,
        session: "unknown",
      },
      multiplier: 1000778000000000000n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 231,
      session: "unknown",
      observedAt: 1000,
      isPausedOnchain: false,
    };

    const next: TokenState = {
      ...prev,
      observedAt: 2000,
      isPausedOnchain: false,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingBstock);
    expect(alerts).toHaveLength(0);
  });

  // Finding 2 tests: with deduplication bypassed
  it("gives exactly one alert across two polls when bStock pause is true", () => {
    const poll0: TokenState = {
      tokenAddress: "0xnvdabaddress",
      ticker: "NVDA",
      issuer: "bstock",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 231,
      session: "unknown",
      observedAt: 1000,
      isPausedOnchain: false,
    };

    const poll1: TokenState = {
      ...poll0,
      observedAt: 2000,
      isPausedOnchain: true,
    };

    const poll2: TokenState = {
      ...poll0,
      observedAt: 3000,
      isPausedOnchain: true,
    };

    // Poll 1 (false -> true): emits alert
    const alerts1 = rule.evaluate(poll0, poll1, mockHoldingBstock);
    expect(alerts1).toHaveLength(1);
    expect(alerts1[0]!.title).toBe("NVDA via bStock is paused");

    // Poll 2 (true -> true): emits nothing (no repeat)
    const alerts2 = rule.evaluate(poll1, poll2, mockHoldingBstock);
    expect(alerts2).toHaveLength(0);
  });

  it("gives two alerts across true -> false -> true transition for bStock", () => {
    const base: TokenState = {
      tokenAddress: "0xnvdabaddress",
      ticker: "NVDA",
      issuer: "bstock",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 231,
      session: "unknown",
      observedAt: 1000,
      isPausedOnchain: false,
    };

    const statePaused1: TokenState = { ...base, observedAt: 2000, isPausedOnchain: true };
    const stateUnpaused: TokenState = { ...base, observedAt: 3000, isPausedOnchain: false };
    const statePaused2: TokenState = { ...base, observedAt: 4000, isPausedOnchain: true };

    const firstAlerts = rule.evaluate(base, statePaused1, mockHoldingBstock);
    expect(firstAlerts).toHaveLength(1);

    const unpausedAlerts = rule.evaluate(statePaused1, stateUnpaused, mockHoldingBstock);
    expect(unpausedAlerts).toHaveLength(0);

    const secondAlerts = rule.evaluate(stateUnpaused, statePaused2, mockHoldingBstock);
    expect(secondAlerts).toHaveLength(1);
  });

  it("emits none plus a warning when bStock isPausedOnchain is null", () => {
    const warnings: string[] = [];
    const onWarn = (msg: string) => warnings.push(msg);

    const prev: TokenState = {
      tokenAddress: "0xnvdabaddress",
      ticker: "NVDA",
      issuer: "bstock",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 231,
      session: "unknown",
      observedAt: 1000,
      isPausedOnchain: false,
    };

    const next: TokenState = {
      ...prev,
      observedAt: 2000,
      isPausedOnchain: null, // Unknown!
    };

    const alerts = rule.evaluate(prev, next, mockHoldingBstock, { onWarn });
    expect(alerts).toHaveLength(0);
    expect(warnings.some((w) => w.includes("unknown"))).toBe(true);
  });
});

describe("ShareCountRule", () => {
  const rule = new ShareCountRule();

  it("explains small multiplier increase as dividend reinvested", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      multiplier: 1_006_000_000_000_000_000n,
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.walletAddress).toBe(mockHoldingOndo.walletAddress.toLowerCase());
    expect(alerts[0]!.body).toBe(
      "Your token count is the same; your shares rose 0.6% (dividend reinvested).",
    );
    expect(alerts[0]!.severity).toBe("info");
  });

  // Finding 4: only name stock split when corporate action status is present
  it("states reason unknown with ratio note when 2:1 ratio has no corporate action status", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null, // no corporate action status!
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      multiplier: 2_000_000_000_000_000_000n,
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toBe(
      "Your token count is the same; your shares rose 100.0% (reason unknown (the ratio is about 2:1, but there is no corporate-action status)).",
    );
  });

  // Finding 1 & 4: names stock split when corporate action status is present, even when Radar has reasons
  it("names stock split when corporate action status is present regardless of radar reasons", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: {
        kind: "limited",
        reasonCode: "ASSET_LIMITED",
        reasonMsg: "stock_split",
        session: "regular",
      },
      multiplier: 1_000_000_000_000_000_000n,
      grade: "B",
      gradeReasons: ["High holder concentration", "No recent whale prints"],
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      multiplier: 2_000_000_000_000_000_000n,
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toBe(
      "Your token count is the same; your shares rose 100.0% (2:1 stock split).",
    );
  });

  // Finding 4: ratio label properly formatted for 3/2 as 3:2
  it("formats 3/2 ratio as 3:2 and not 3/2:1", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: {
        kind: "limited",
        reasonCode: "ASSET_LIMITED",
        reasonMsg: "stock_split",
        session: "regular",
      },
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    // 1.5x ratio (3/2)
    const next: TokenState = {
      ...prev,
      multiplier: 1_500_000_000_000_000_000n,
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toBe(
      "Your token count is the same; your shares rose 50.0% (3:2 stock split).",
    );
  });
});

describe("GradeDropRule", () => {
  const rule = new GradeDropRule();

  it("emits an alert using Radar gradeReasons and never status text", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdabaddress",
      ticker: "TSLA",
      issuer: "bstock",
      status: {
        kind: "paused",
        reasonCode: "MARKET_PAUSED",
        reasonMsg: "Paused for session transition",
        session: "closed",
      },
      multiplier: 10n ** 18n,
      grade: "B",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 250,
      session: "closed",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      grade: "D",
      gradeReasons: ["no real trade for 3 days"],
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, {
      ...mockHoldingBstock,
      ticker: "TSLA",
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.walletAddress).toBe(mockHoldingBstock.walletAddress.toLowerCase());
    expect(alerts[0]!.title).toBe("TSLA via bStock grade dropped");
    expect(alerts[0]!.body).toBe("TSLA via bStock dropped B → D: no real trade for 3 days.");
    expect(alerts[0]!.body).not.toContain("session transition");
    expect(alerts[0]!.severity).toBe("critical");
  });

  it("says reason not recorded in the snapshot when gradeReasons is empty", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdabaddress",
      ticker: "TSLA",
      issuer: "bstock",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 250,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      grade: "B",
      gradeReasons: [],
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingBstock);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toBe(
      "NVDA via bStock dropped A → B: reason not recorded in the snapshot.",
    );
  });
});

describe("GhostRule", () => {
  const rule = new GhostRule();

  it("emits an alert including trade age when token becomes a ghost", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      ghost: true,
      lastRealTradeAgeDays: 3.5,
      evidenceKey: "flow-ghost",
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.walletAddress).toBe(mockHoldingOndo.walletAddress.toLowerCase());
    expect(alerts[0]!.severity).toBe("critical");
    expect(alerts[0]!.body).toBe(
      "There's no market to sell this token on BNB Chain right now (no real trade for 3 days).",
    );
    expect(alerts[0]!.evidence.snapshotKind).toBe("flow-ghost");
  });
});

describe("PriceThresholdRule", () => {
  const rule = new PriceThresholdRule();

  it("emits an alert with direction in id and wallet address", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 10n ** 18n,
      grade: "A",
      gradeReasons: [],
      ghost: false,
      sharePriceUsd: 125,
      session: "regular",
      observedAt: 1000,
      isPausedOnchain: null,
    };

    const next: TokenState = {
      ...prev,
      sharePriceUsd: 118.5,
      observedAt: 2000,
    };

    const ports = {
      priceThresholds: {
        "0xnvdaonaddress": { minPriceUsd: 120 },
      },
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo, ports);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.id).toContain(":min:");
    expect(alerts[0]!.walletAddress).toBe(mockHoldingOndo.walletAddress.toLowerCase());
  });
});

describe("EarningsRule", () => {
  const rule = new EarningsRule();

  it("remains disabled pending confirmation at Gate V-E", () => {
    expect(rule.disabled).toBe(true);
    expect(rule.disabledReason).toContain("Gate V-E");
    const alerts = rule.evaluate(null, {} as TokenState, mockHoldingOndo);
    expect(alerts).toEqual([]);
  });
});
