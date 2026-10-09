import { describe, expect, it } from "vitest";
import {
  buildPortfolioSuggestions,
  addressHash,
  type CandidateTokenInput,
  SUGGESTIONS_REASON_TEXT,
  SUGGESTIONS_CATCHING_UP_TEXT,
  SUGGESTIONS_FIXTURE_TEXT,
} from "./suggestions";
import { E18 } from "@tally/core";

const SAMPLE_CANDIDATES: CandidateTokenInput[] = [
  {
    ticker: "NVDA",
    symbol: "NVDAB",
    issuer: "bstock",
    name: "NVIDIA Corp",
    grade: "A",
    score: 95,
    cleanedVolumeUsd: 500_000n * E18,
    reason: "High volume on-chain",
  },
  {
    ticker: "AAPL",
    symbol: "AAPLB",
    issuer: "bstock",
    name: "Apple Inc",
    grade: "A",
    score: 92,
    cleanedVolumeUsd: 400_000n * E18,
    reason: "Consistent liquidity",
  },
  {
    ticker: "TSLA",
    symbol: "TSLAB",
    issuer: "bstock",
    name: "Tesla Inc",
    grade: "B",
    score: 85,
    cleanedVolumeUsd: 300_000n * E18,
    reason: "Active flow",
  },
  {
    ticker: "QQQ",
    symbol: "QQQB",
    issuer: "bstock",
    name: "Invesco QQQ",
    grade: "A",
    score: 90,
    cleanedVolumeUsd: 250_000n * E18,
    reason: "High ETF volume",
  },
  {
    ticker: "SPY",
    symbol: "SPYB",
    issuer: "bstock",
    name: "SPDR S&P 500",
    grade: "B",
    score: 88,
    cleanedVolumeUsd: 200_000n * E18,
    reason: "Broad liquidity",
  },
  {
    ticker: "GOOGL",
    symbol: "GOOGLB",
    issuer: "bstock",
    name: "Alphabet Inc",
    grade: "A",
    score: 89,
    cleanedVolumeUsd: 180_000n * E18,
    reason: "Strong market depth",
  },
  {
    ticker: "AMZN",
    symbol: "AMZNon",
    issuer: "ondo",
    name: "Amazon.com Inc",
    grade: "B",
    score: 84,
    cleanedVolumeUsd: 150_000n * E18,
    reason: "Regular trading",
  },
  {
    ticker: "MSFT",
    symbol: "MSFTB",
    issuer: "bstock",
    name: "Microsoft Corp",
    grade: "A",
    score: 91,
    cleanedVolumeUsd: 120_000n * E18,
    reason: "Liquid issuer pool",
  },
  {
    ticker: "META",
    symbol: "METAB",
    issuer: "bstock",
    name: "Meta Platforms",
    grade: "B",
    score: 83,
    cleanedVolumeUsd: 100_000n * E18,
    reason: "Good volume",
  },
];

describe("WO-03 Portfolio Suggestions Pure Tests", () => {
  it("holds 0 tickers suggests 3", () => {
    const res = buildPortfolioSuggestions({
      held: [],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: null,
    });
    expect(res.state).toBe("ok");
    expect(res.count).toBe(3);
    expect(res.items).toHaveLength(3);
    expect(res.reasonText).toBe(SUGGESTIONS_REASON_TEXT);
    // Unrotated top 3: NVDA (500k), AAPL (400k), TSLA (300k)
    expect(res.items.map((i) => i.ticker)).toEqual(["NVDA", "AAPL", "TSLA"]);
    expect(res.items[0]).toEqual({
      ticker: "NVDA",
      symbol: "NVDAB",
      issuer: "bstock",
      name: "NVIDIA Corp",
      grade: "A",
      label: "Liquid",
      volume24hUsd: "500000",
      reason: "High volume on-chain",
    });
  });

  it("holds 1 ticker suggests 2", () => {
    const res = buildPortfolioSuggestions({
      held: ["NVDA"],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: null,
    });
    expect(res.state).toBe("ok");
    expect(res.count).toBe(2);
    expect(res.items).toHaveLength(2);
    // Held NVDA is excluded; next 2 are AAPL and TSLA
    expect(res.items.map((i) => i.ticker)).toEqual(["AAPL", "TSLA"]);
  });

  it("holds 2 tickers suggests 1", () => {
    const res = buildPortfolioSuggestions({
      held: ["NVDA", "AAPL"],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: null,
    });
    expect(res.state).toBe("ok");
    expect(res.count).toBe(1);
    expect(res.items).toHaveLength(1);
    // Held NVDA and AAPL excluded; next is TSLA
    expect(res.items[0]!.ticker).toBe("TSLA");
  });

  it("holds 3 tickers suggests none (state: none_needed)", () => {
    const res = buildPortfolioSuggestions({
      held: ["NVDA", "AAPL", "TSLA"],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: null,
    });
    expect(res.state).toBe("none_needed");
    expect(res.count).toBe(0);
    expect(res.items).toEqual([]);
    expect(res.reasonText).toBe("");
  });

  it("holds 4 tickers suggests none (state: none_needed)", () => {
    const res = buildPortfolioSuggestions({
      held: ["NVDA", "AAPL", "TSLA", "QQQ"],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: null,
    });
    expect(res.state).toBe("none_needed");
    expect(res.count).toBe(0);
    expect(res.items).toEqual([]);
    expect(res.reasonText).toBe("");
  });

  it("dust does not count: balances under $1 do not count towards held total", () => {
    // 1 ticker with $50 (held), 2 tickers with dust ($0.20 and $0.50)
    const held = [
      { ticker: "NVDA", valueUsd: 50.0 },
      { ticker: "AAPL", valueUsd: 0.2 },
      { ticker: "TSLA", valueUsd: 0.5 },
    ];
    const res = buildPortfolioSuggestions({
      held,
      candidates: SAMPLE_CANDIDATES,
      walletAddress: null,
    });
    // Only NVDA counts as held (heldCount = 1). Suggests 3 - 1 = 2 items.
    expect(res.state).toBe("ok");
    expect(res.count).toBe(2);
    expect(res.items).toHaveLength(2);
    // NVDA was non-dust held, so never suggested
    expect(res.items.some((i) => i.ticker === "NVDA")).toBe(false);
  });

  it("the held ticker is never suggested even if it has the highest liquidity", () => {
    // NVDA has 500k volume (highest). Since user holds NVDA, it must never appear.
    const res = buildPortfolioSuggestions({
      held: ["NVDA"],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: null,
    });
    expect(res.items.some((i) => i.ticker === "NVDA")).toBe(false);
  });

  it("both issuers enabled picks the more liquid", () => {
    const candidatesWithTwoIssuers: CandidateTokenInput[] = [
      {
        ticker: "NVDA",
        symbol: "NVDAon",
        issuer: "ondo",
        name: "NVIDIA Corp",
        grade: "B",
        score: 80,
        cleanedVolumeUsd: 100_000n * E18,
      },
      {
        ticker: "NVDA",
        symbol: "NVDAB",
        issuer: "bstock",
        name: "NVIDIA Corp",
        grade: "A",
        score: 95,
        cleanedVolumeUsd: 500_000n * E18,
      },
      {
        ticker: "AAPL",
        symbol: "AAPLB",
        issuer: "bstock",
        name: "Apple Inc",
        grade: "A",
        score: 92,
        cleanedVolumeUsd: 300_000n * E18,
      },
    ];

    const res = buildPortfolioSuggestions({
      held: [],
      candidates: candidatesWithTwoIssuers,
      walletAddress: null,
    });

    expect(res.state).toBe("ok");
    // Between NVDAon (100k) and NVDAB (500k), NVDAB is picked
    const nvda = res.items.find((i) => i.ticker === "NVDA");
    expect(nvda).toBeDefined();
    expect(nvda!.issuer).toBe("bstock");
    expect(nvda!.symbol).toBe("NVDAB");
    expect(nvda!.volume24hUsd).toBe("500000");
    // Ensure NVDA only appears once
    expect(res.items.filter((i) => i.ticker === "NVDA")).toHaveLength(1);
  });

  it("rotation is stable per address and differs between two addresses", () => {
    const addressA = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";
    const addressB = "0x1111111111111111111111111111111111111111";

    const resA1 = buildPortfolioSuggestions({
      held: [],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: addressA,
    });
    const resA2 = buildPortfolioSuggestions({
      held: [],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: addressA,
    });

    // Stability: identical calls with same address return identical items in identical order
    expect(resA1.items.map((i) => i.ticker)).toEqual(resA2.items.map((i) => i.ticker));

    const resB = buildPortfolioSuggestions({
      held: [],
      candidates: SAMPLE_CANDIDATES,
      walletAddress: addressB,
    });

    // Difference: address A and address B yield different starting positions
    const tickersA = resA1.items.map((i) => i.ticker);
    const tickersB = resB.items.map((i) => i.ticker);
    expect(tickersA).not.toEqual(tickersB);

    // Verify hash properties
    expect(addressHash(addressA)).toBe(addressHash(addressA));
    expect(addressHash(addressA)).not.toBe(addressHash(addressB));
  });

  it("29 fresh candidates and one stale row still yields suggestions", () => {
    const candidates: CandidateTokenInput[] = [];
    for (let i = 1; i <= 29; i++) {
      candidates.push({
        ticker: `TK${i}`,
        symbol: `TK${i}B`,
        issuer: "bstock",
        name: `Token ${i}`,
        grade: "A",
        score: 90,
        cleanedVolumeUsd: BigInt(i * 10_000) * E18,
        reason: "Liquid on-chain",
      });
    }
    // 1 stale candidate with highest volume
    candidates.push({
      ticker: "STALE",
      symbol: "STALEB",
      issuer: "bstock",
      name: "Stale High Volume",
      grade: "A",
      score: 99,
      stale: true,
      cleanedVolumeUsd: 1_000_000n * E18,
      reason: "Stale row",
    });

    const res = buildPortfolioSuggestions({
      held: [],
      candidates,
      walletAddress: null,
    });

    expect(res.state).toBe("ok");
    expect(res.count).toBe(3);
    expect(res.items).toHaveLength(3);
    expect(res.items.some((i) => i.ticker === "STALE")).toBe(false);
  });

  it("all candidates stale means unavailable with proper reason text", () => {
    const staleCandidates = SAMPLE_CANDIDATES.map((c) => ({ ...c, stale: true }));
    const resLive = buildPortfolioSuggestions({
      held: [],
      candidates: staleCandidates,
      isFixture: false,
    });
    expect(resLive.state).toBe("unavailable");
    expect(resLive.count).toBe(0);
    expect(resLive.items).toEqual([]);
    expect(resLive.reasonText).toBe(SUGGESTIONS_CATCHING_UP_TEXT);

    const resFixture = buildPortfolioSuggestions({
      held: [],
      candidates: staleCandidates,
      isFixture: true,
    });
    expect(resFixture.state).toBe("unavailable");
    expect(resFixture.fixture).toBe(true);
    expect(resFixture.count).toBe(0);
    expect(resFixture.items).toEqual([]);
    expect(resFixture.reasonText).toBe(SUGGESTIONS_FIXTURE_TEXT);
  });

  it("when running on fixtures (isFixture: true), reasonText and item reasons say 'Fixture data' even in ok state", () => {
    const res = buildPortfolioSuggestions({
      held: [],
      candidates: SAMPLE_CANDIDATES,
      isFixture: true,
    });
    expect(res.state).toBe("ok");
    expect(res.fixture).toBe(true);
    expect(res.reasonText).toBe(SUGGESTIONS_FIXTURE_TEXT);
    expect(res.items.length).toBe(3);
    expect(res.items.every((i) => i.reason === SUGGESTIONS_FIXTURE_TEXT)).toBe(true);
  });

  it("missing Radar means unavailable", () => {
    const res = buildPortfolioSuggestions({
      held: [],
      candidates: [],
      radarMissing: true,
    });
    expect(res.state).toBe("unavailable");
    expect(res.count).toBe(0);
    expect(res.items).toEqual([]);
    expect(res.reasonText).toBe(SUGGESTIONS_CATCHING_UP_TEXT);
  });

  it("filters out ghost tokens and grades below B", () => {
    const candidates: CandidateTokenInput[] = [
      {
        ticker: "GHOST",
        symbol: "GHOSTB",
        issuer: "bstock",
        name: "Ghost Market",
        grade: "A",
        ghost: true,
        cleanedVolumeUsd: 999_999n * E18,
      },
      {
        ticker: "LOW",
        symbol: "LOWB",
        issuer: "bstock",
        name: "Low Grade",
        grade: "C",
        cleanedVolumeUsd: 888_888n * E18,
      },
      {
        ticker: "STALE",
        symbol: "STALEB",
        issuer: "bstock",
        name: "Stale Token",
        grade: "A",
        stale: true,
        cleanedVolumeUsd: 777_777n * E18,
      },
      {
        ticker: "GOOD",
        symbol: "GOODB",
        issuer: "bstock",
        name: "Good Token",
        grade: "A",
        cleanedVolumeUsd: 50_000n * E18,
      },
    ];

    const res = buildPortfolioSuggestions({
      held: [],
      candidates,
    });

    expect(res.state).toBe("ok");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.ticker).toBe("GOOD");
  });
});
