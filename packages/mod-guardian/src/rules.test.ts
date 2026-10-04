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
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
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
      ghost: false,
      sharePriceUsd: 230,
      session: "closed",
      observedAt: 2000,
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
      ghost: false,
      sharePriceUsd: 231,
      session: "unknown",
      observedAt: 1000,
    };

    const next: TokenState = {
      ...prev,
      observedAt: 2000,
    };

    // No pause port returned true
    const alerts = rule.evaluate(prev, next, mockHoldingBstock, {
      isPaused: () => false,
    });
    expect(alerts).toHaveLength(0);
  });

  it("emits an alert for bStock only when the injected isPaused port returns true", () => {
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
      ghost: false,
      sharePriceUsd: 231,
      session: "unknown",
      observedAt: 1000,
      isPausedOnchain: false,
    };

    const next: TokenState = {
      ...prev,
      observedAt: 2000,
      isPausedOnchain: true,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingBstock, {
      isPaused: (addr) => addr.toLowerCase() === "0xnvdabaddress",
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule).toBe("paused");
    expect(alerts[0]!.title).toBe("NVDA via bStock is paused");
    expect(alerts[0]!.body).toContain("paused by its pause manager. Your shares are unchanged.");
    expect(alerts[0]!.evidence.snapshotKind).toBe("onchain:pause");
  });
});

describe("ShareCountRule", () => {
  const rule = new ShareCountRule();

  it("explains small multiplier increase as dividend reinvested", () => {
    // 0.6% increase: 1.0000 -> 1.0060
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
    };

    const next: TokenState = {
      ...prev,
      multiplier: 1_006_000_000_000_000_000n,
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toBe(
      "Your token count is the same; your shares rose 0.6% (dividend reinvested).",
    );
    expect(alerts[0]!.severity).toBe("info");
  });

  it("explains 2:1 ratio change as a stock split", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
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

  it("explains arbitrary unclassified ratio jump as reason unknown", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
    };

    // 17.3% jump (not a simple ratio, > 3% jump limit)
    const next: TokenState = {
      ...prev,
      multiplier: 1_173_000_000_000_000_000n,
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.body).toContain("reason unknown");
  });

  it("emits nothing when multiplier is unchanged", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
    };

    const alerts = rule.evaluate(prev, { ...prev, observedAt: 2000 }, mockHoldingOndo);
    expect(alerts).toHaveLength(0);
  });
});

describe("GradeDropRule", () => {
  const rule = new GradeDropRule();

  it("emits an alert when grade drops from B to D", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdabaddress",
      ticker: "TSLA",
      issuer: "bstock",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "B",
      ghost: false,
      sharePriceUsd: 250,
      session: "regular",
      observedAt: 1000,
    };

    const next: TokenState = {
      ...prev,
      grade: "D",
      status: {
        kind: "open",
        reasonCode: "TRADING",
        reasonMsg: "no real trade for 3 days",
        session: "regular",
      },
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, {
      ...mockHoldingBstock,
      ticker: "TSLA",
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe("TSLA via bStock grade dropped");
    expect(alerts[0]!.body).toBe("TSLA via bStock dropped B → D: no real trade for 3 days.");
    expect(alerts[0]!.severity).toBe("critical");
  });

  it("does not emit an alert when grade improves or stays same", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdabaddress",
      ticker: "TSLA",
      issuer: "bstock",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "C",
      ghost: false,
      sharePriceUsd: 250,
      session: "regular",
      observedAt: 1000,
    };

    const improved: TokenState = { ...prev, grade: "B", observedAt: 2000 };
    expect(rule.evaluate(prev, improved, mockHoldingBstock)).toHaveLength(0);

    const same: TokenState = { ...prev, grade: "C", observedAt: 2000 };
    expect(rule.evaluate(prev, same, mockHoldingBstock)).toHaveLength(0);
  });
});

describe("GhostRule", () => {
  const rule = new GhostRule();

  it("emits an alert when token becomes a ghost", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      ghost: false,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
    };

    const next: TokenState = {
      ...prev,
      ghost: true,
      evidenceKey: "flow-ghost",
      observedAt: 2000,
    };

    const alerts = rule.evaluate(prev, next, mockHoldingOndo);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("critical");
    expect(alerts[0]!.body).toBe("There's no market to sell this token on BNB Chain right now.");
    expect(alerts[0]!.evidence.snapshotKind).toBe("flow-ghost");
  });

  it("does not re-alert when token was already a ghost", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "F",
      ghost: true,
      sharePriceUsd: 230,
      session: "regular",
      observedAt: 1000,
    };

    const next: TokenState = { ...prev, observedAt: 2000 };
    expect(rule.evaluate(prev, next, mockHoldingOndo)).toHaveLength(0);
  });
});

describe("PriceThresholdRule", () => {
  const rule = new PriceThresholdRule();

  it("emits an alert when price falls below minimum in regular session", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      ghost: false,
      sharePriceUsd: 125,
      session: "regular",
      observedAt: 1000,
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
    expect(alerts[0]!.title).toBe("NVDA fell below $120.00");
    expect(alerts[0]!.body).toBe(
      "NVDA per-share price is $118.50, below your alert threshold of $120.00.",
    );
    expect(alerts[0]!.severity).toBe("warning");
  });

  it("does not emit an alert outside regular session", () => {
    const prev: TokenState = {
      tokenAddress: "0xnvdaonaddress",
      ticker: "NVDA",
      issuer: "ondo",
      status: null,
      multiplier: 1_000_000_000_000_000_000n,
      grade: "A",
      ghost: false,
      sharePriceUsd: 125,
      session: "overnight",
      observedAt: 1000,
    };

    const next: TokenState = {
      ...prev,
      sharePriceUsd: 115,
      session: "overnight",
      observedAt: 2000,
    };

    const ports = {
      priceThresholds: {
        "0xnvdaonaddress": { minPriceUsd: 120 },
      },
    };

    // In overnight session, regular session requirement prevents alert
    const alerts = rule.evaluate(prev, next, mockHoldingOndo, ports);
    expect(alerts).toHaveLength(0);
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
