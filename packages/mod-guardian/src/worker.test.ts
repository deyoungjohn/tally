import { describe, expect, it } from "vitest";
import { openStore } from "@tally/modkit";
import {
  hasTokenStateChanged,
  haveAlertsChanged,
  runGuardianEvaluation,
  type GuardianJobContext,
} from "./worker";
import type { Alert, RadarSnapshotSubset, TokenState } from "./types";

describe("Guardian Worker (worker.ts)", () => {
  const wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930";
  const nvdaAddr = "0x8317e13203f19e4875630325d7ef11739c90b6ec";
  const vicrAddr = "0xa59469d91563caeeddd2ffc731f41215e7b691ef";

  it("pure diff checks haveAlertsChanged and hasTokenStateChanged correctly detect changes", () => {
    const alert1: Alert = {
      id: "a1",
      walletAddress: wallet,
      rule: "paused",
      ticker: "NVDA",
      issuer: "bstock",
      severity: "warning",
      title: "Title",
      body: "Body",
      evidence: { snapshotKind: "status", snapshotKey: "key", observedAt: 100 },
      createdAt: 100,
    };
    expect(haveAlertsChanged([], [alert1])).toBe(true);
    expect(haveAlertsChanged([alert1], [alert1])).toBe(false);
    expect(haveAlertsChanged([alert1], [{ ...alert1, deliveredAt: 200 }])).toBe(true);
    expect(haveAlertsChanged([alert1], [{ ...alert1, deliveryAttempts: 2 }])).toBe(true);

    const state1: TokenState = {
      tokenAddress: nvdaAddr,
      ticker: "NVDA",
      issuer: "ondo",
      observedAt: 100,
      status: null,
      multiplier: 10n ** 18n,
      grade: "B",
      gradeReasons: [],
      ghost: false,
      lastRealTradeAgeDays: 0,
      sharePriceUsd: 120,
      session: "regular",
      isPausedOnchain: false,
    };
    // No change even if observedAt is newer
    expect(hasTokenStateChanged(state1, { ...state1, observedAt: 200 })).toBe(false);
    // Grade changed
    expect(hasTokenStateChanged(state1, { ...state1, grade: "D" })).toBe(true);
    // Paused changed
    expect(hasTokenStateChanged(state1, { ...state1, isPausedOnchain: true })).toBe(true);
  });

  it("radar row dropping B -> D produces one grade-drop alert (Finding 1)", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      isProduction: false,
    };

    // Active wallet
    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Portfolio with NVDA holding
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    // Radar snapshot initially at Grade B
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    // Run 1: sets up initial baseline state in guardian-state
    const run1 = await runGuardianEvaluation(ctx);
    expect(run1.evaluatedWallets).toBe(1);
    expect(run1.generatedAlerts).toBe(0);

    const initialAlerts = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000 });
    expect(initialAlerts).toBeNull();

    // Now Radar grade drops from B -> D
    currentTime += 60_000;
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "D",
        reasons: ["stale prices", "spread high"],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    // Run 2: grade drop detected
    const run2 = await runGuardianEvaluation(ctx);
    expect(run2.evaluatedWallets).toBe(1);
    expect(run2.generatedAlerts).toBe(1);

    const alertsAfterRun2 =
      store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000 })?.data ?? [];
    expect(alertsAfterRun2).toHaveLength(1);
    expect(alertsAfterRun2[0]!.rule).toBe("grade-drop");
    expect(alertsAfterRun2[0]!.title).toContain("NVDA via Ondo grade dropped");
    expect(alertsAfterRun2[0]!.body).toContain("stale prices; spread high");
  });

  it("two identical runs leave one alerts row and one guardian-state row (Finding 3: no disk bloat)", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: () => {},
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    // Run 1: sets baseline
    await runGuardianEvaluation(ctx);
    expect(store.history("guardian-state", nvdaAddr, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);

    // Grade drops
    currentTime += 60_000;
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "F",
        reasons: ["severe spread"],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    // Run 2: generates alert and writes alerts snapshot + new guardian-state
    await runGuardianEvaluation(ctx);
    expect(store.history("alerts", wallet, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
    expect(store.history("guardian-state", nvdaAddr, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(2);

    // Run 3: identical state (1 minute later, no new radar, no delivery changes)
    currentTime += 60_000;
    await runGuardianEvaluation(ctx);

    // Verify MUST NOT write duplicate rows to store
    const alertHistory = store.history("alerts", wallet, 0, Number.MAX_SAFE_INTEGER);
    expect(alertHistory).toHaveLength(1); // Still exactly 1 row, not 2!

    const stateHistory = store.history("guardian-state", nvdaAddr, 0, Number.MAX_SAFE_INTEGER);
    expect(stateHistory).toHaveLength(2); // Still exactly 2 rows, not 3!
  });

  it("stale or missing radar snapshot warns once per run (Finding 1)", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    // No radar snapshot put
    await runGuardianEvaluation(ctx);
    expect(warnings.some((w) => w.includes("Radar snapshot missing for token"))).toBe(true);

    // Now put stale radar snapshot (older than 2h = 7_200_000 ms)
    warnings.length = 0;
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime - 8_000_000,
    });

    await runGuardianEvaluation(ctx);
    expect(warnings.some((w) => w.includes("Radar snapshot is stale for token"))).toBe(true);
  });

  it("resolves issuer from radar if holding lacks it, and warns on bStock pause (Findings 2 & 4)", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Holding has no issuer specified
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: null,
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    // Radar provides issuer "bstock"
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "bstock",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    await runGuardianEvaluation(ctx);

    // Check updated inactive wording when pauseState is not configured
    expect(
      warnings.some((w) =>
        w.includes("bStock pause alerts are inactive: engine.pauseState is not configured"),
      ),
    ).toBe(true);

    // Check token state was successfully built with issuer bstock
    const state = store.latest<TokenState>("guardian-state", nvdaAddr, { maxAgeMs: 60_000 });
    expect(state?.data?.issuer).toBe("bstock");
  });

  it("skips holding with warning if issuer cannot be resolved from holding or radar (Finding 2)", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Holding has no issuer
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: null,
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    // Radar also has no issuer
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: null,
        grade: "B",
        reasons: [],
        ghost: false,
      } as unknown as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    await runGuardianEvaluation(ctx);

    expect(warnings.some((w) => w.includes("unknown issuer"))).toBe(true);
    // Token state not built
    expect(store.latest("guardian-state", nvdaAddr, { maxAgeMs: 60_000 })).toBeNull();
  });

  // Re-review 2 Finding 1: Ondo pause alert from registry/bsc snapshot
  it("produces an Ondo pause alert when registry/bsc status transitions to MARKET_PAUSED (Re-review 2 Finding 1)", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: () => {},
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Portfolio with VICR holding
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: vicrAddr,
            ticker: "VICR",
            issuer: "ondo",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    // Radar snapshot
    store.put({
      kind: "radar",
      key: vicrAddr,
      data: {
        ticker: "VICR",
        address: vicrAddr,
        issuer: "ondo",
        grade: "A",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    // Initial registry/bsc snapshot with TRADING status
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          tokenContractAddress: vicrAddr,
          platformId: "ondo",
          underlyingTicker: "VICR",
          statusInfo: {
            openState: true,
            marketStatus: "regular",
            reasonCode: "TRADING",
            reasonMsg: null,
          },
        },
      ],
      source: "binance:rwa/tokens",
      observedAt: currentTime,
    });

    // Run 1: sets baseline state (open)
    const run1 = await runGuardianEvaluation(ctx);
    expect(run1.generatedAlerts).toBe(0);

    // Run 2: registry/bsc updates to MARKET_PAUSED
    currentTime += 60_000;
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          tokenContractAddress: vicrAddr,
          platformId: "ondo",
          underlyingTicker: "VICR",
          statusInfo: {
            openState: false,
            marketStatus: "offhours",
            reasonCode: "MARKET_PAUSED",
            reasonMsg: "Paused for session transition",
          },
        },
      ],
      source: "binance:rwa/tokens",
      observedAt: currentTime,
    });

    const run2 = await runGuardianEvaluation(ctx);
    expect(run2.generatedAlerts).toBe(1);

    const alerts = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000 })?.data ?? [];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule).toBe("paused");
    expect(alerts[0]!.ticker).toBe("VICR");
    expect(alerts[0]!.issuer).toBe("ondo");
    expect(alerts[0]!.title).toContain("VICR via Ondo is paused");
    expect(alerts[0]!.body).toContain("session transition");
  });

  // Re-review 2 Finding 1: Multiplier change alert derived from portfolio balanceShares & balanceTokens
  it("produces share-count change alert from multiplier derived from portfolio snapshot (Re-review 2 Finding 1)", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: () => {},
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Portfolio with NVDA holding initially at 1:1 ratio (multiplier = 1e18)
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 100n * 10n ** 18n,
            balanceShares: 100n * 10n ** 18n, // multiplier = 1e18
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    // Run 1: sets baseline with multiplier = 1e18
    await runGuardianEvaluation(ctx);

    // Run 2: portfolio reflects a 2:1 stock split (balanceShares doubles to 200)
    currentTime += 60_000;
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 100n * 10n ** 18n,
            balanceShares: 200n * 10n ** 18n, // multiplier = 2e18 (doubled)
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    const run2 = await runGuardianEvaluation(ctx);
    expect(run2.generatedAlerts).toBe(1);

    const alerts = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000 })?.data ?? [];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule).toBe("share-count");
    expect(alerts[0]!.ticker).toBe("NVDA");
    expect(alerts[0]!.title).toContain("NVDA via Ondo share multiplier changed");
    expect(alerts[0]!.body).toContain("2:1");
  });

  // Re-review 2 Finding 2: Persistent conditions do not re-alert after 25 hours
  it("persistent conditions like ghost token do not re-alert after 25 hours (Re-review 2 Finding 2)", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: () => {},
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    // Run 1: baseline, ghost is false
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    await runGuardianEvaluation(ctx);

    // Run 2: token becomes ghost at hour 1
    currentTime += 60_000;
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: true,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    const run2 = await runGuardianEvaluation(ctx);
    expect(run2.generatedAlerts).toBe(1);
    expect(store.history("alerts", wallet, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);

    // Advance 25 hours into the future (past standard 24h cooldown)
    // No new guardian-state row was written during these 25 hours because state was unchanged
    currentTime += 25 * 3600 * 1000;

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: true,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    const run3 = await runGuardianEvaluation(ctx);
    // MUST NOT re-alert because state is still ghost (isGhost && !wasGhost is false)
    expect(run3.generatedAlerts).toBe(0);
    expect(store.history("alerts", wallet, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
  });

  // Re-review 2 Finding 6: Uses holding.ticker on TokenState instead of radar ticker
  it("uses holding.ticker on TokenState instead of radar.ticker (Re-review 2 Finding 6)", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: () => {},
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Holding has ticker "NVDA"
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    // Radar snapshot has a different or fallback ticker
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "RADAR_NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    await runGuardianEvaluation(ctx);

    const state = store.latest<TokenState>("guardian-state", nvdaAddr, { maxAgeMs: 60_000 });
    expect(state?.data?.ticker).toBe("NVDA");
  });

  // Re-review 3 Finding 1: Multiplier rounding tolerance and determinism
  it("balance change with same true multiplier raises no alert due to 100 ppm tolerance (Finding 1)", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: () => {},
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Run 1: baseline holding with multiplier = 1e18
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 100n * 10n ** 18n,
            balanceShares: 100n * 10n ** 18n, // 1e18
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    await runGuardianEvaluation(ctx);

    // Run 2: wallet buys more tokens, balance changes, small rounding discrepancy of 50 ppm
    currentTime += 60_000;
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 150n * 10n ** 18n,
            // 50 ppm diff from 1e18 (diff = 50 * 10^12)
            balanceShares: 150n * 10n ** 18n + 7_500_000_000_000_000n,
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    const run2 = await runGuardianEvaluation(ctx);
    // Tolerance carries forward previous multiplier; no false share-count alert
    expect(run2.generatedAlerts).toBe(0);

    const alerts = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000 })?.data ?? [];
    expect(alerts).toHaveLength(0);
  });

  it("+0.58% (+5800 ppm) multiplier change raises exactly one alert (Finding 1)", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: () => {},
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Run 1: baseline with multiplier = 1e18
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 100n * 10n ** 18n,
            balanceShares: 100n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    await runGuardianEvaluation(ctx);

    // Run 2: +0.58% (+5800 ppm) increase in multiplier (e.g. dividend reinvested)
    currentTime += 60_000;
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 100n * 10n ** 18n,
            balanceShares: 100_580_000_000_000_000_000n, // +0.58%
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    const run2 = await runGuardianEvaluation(ctx);
    expect(run2.generatedAlerts).toBe(1);

    const alerts = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000 })?.data ?? [];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule).toBe("share-count");
    expect(alerts[0]!.body).toContain("dividend reinvested");
  });

  it("two wallets with different balances give the same state multiplier (Finding 1)", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;
    const walletB = "0x9876543210987654321098765432109876543210";

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: () => {},
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });
    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: walletB },
      source: "test",
      observedAt: currentTime,
    });

    // Wallet A has small balance with slight integer rounding
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 10n * 10n ** 18n + 3n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    // Wallet B has large balance with exact 1:1 ratio
    store.put({
      kind: "portfolio",
      key: walletB,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 10_000n * 10n ** 18n,
            balanceShares: 10_000n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    await runGuardianEvaluation(ctx);

    const state = store.latest<TokenState>("guardian-state", nvdaAddr, { maxAgeMs: 60_000 });
    // Deterministically selected candidate from Wallet B (largest token balance)
    expect(state?.data?.multiplier).toBe(10n ** 18n);
  });

  // Re-review 3 Finding 4: Missing inputs warnings
  it("warns when registry/bsc snapshot is missing or stale (Finding 4)", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Run 1: registry/bsc is missing
    await runGuardianEvaluation(ctx);
    expect(warnings).toContain("Registry snapshot missing: registry/bsc");

    // Run 2: registry/bsc is stale (>600s)
    warnings.length = 0;
    store.put({
      kind: "registry",
      key: "bsc",
      data: [],
      source: "registry",
      observedAt: currentTime,
    });

    currentTime += 700_000; // 700s > 600s maxAgeMs
    await runGuardianEvaluation(ctx);
    expect(warnings.some((w) => w.startsWith("Registry snapshot is stale: registry/bsc"))).toBe(
      true,
    );
  });

  it("warns when linked chats exist but TELEGRAM_BOT_TOKEN / ctx.sender is not configured (Finding 4)", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      sender: undefined, // No sender configured
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "guardian-link",
      key: wallet,
      data: {
        walletAddress: wallet,
        chatId: 123456789,
        linkedAt: currentTime,
        alertsEnabled: true,
      },
      source: "guardian-link",
      observedAt: currentTime,
    });

    await runGuardianEvaluation(ctx);
    expect(warnings).toContain(
      "Linked Telegram chats exist, but TELEGRAM_BOT_TOKEN is not configured; alerts are stored, not delivered",
    );
  });

  // bStock pause alerts via engine.pauseState
  it("bStock holding when pauseState returns paused: true gives exactly one alert", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      pauseState: async (_token) => ({
        paused: true,
        reason: null,
        observedAt: currentTime,
      }),
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "bstock",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "bstock",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    const run = await runGuardianEvaluation(ctx);
    expect(run.generatedAlerts).toBe(1);

    const alerts = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000 })?.data ?? [];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.rule).toBe("paused");
    expect(alerts[0]!.title).toBe("NVDA via bStock is paused");
    expect(alerts[0]!.body).toContain("is paused by its pause manager");
    expect(alerts[0]!.severity).toBe("warning");
  });

  it("bStock holding when pauseState returns paused: null gives zero alerts and one warning", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      pauseState: async (_token) => ({
        paused: null,
        reason: "pause check reverted",
        observedAt: currentTime,
      }),
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "bstock",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "bstock",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    const run = await runGuardianEvaluation(ctx);
    expect(run.generatedAlerts).toBe(0);

    const alerts = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 60_000 });
    expect(alerts).toBeNull();

    expect(
      warnings.some(
        (w) =>
          w.includes("bStock pause state for NVDA") &&
          w.includes("is unknown; no pause alert evaluated"),
      ),
    ).toBe(true);
  });

  it("redacts secret URLs when pauseState throws with an RPC endpoint URL", async () => {
    const store = openStore(":memory:");
    const currentTime = 1_000_000;
    const warnings: string[] = [];

    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      pauseState: async () => {
        throw new Error(
          "HTTP 500 error connecting to https://bsc.rpc.nodereal.io/?apikey=SECRET_KEY_999: timeout",
        );
      },
      isProduction: false,
    };

    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "bstock",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "test",
      observedAt: currentTime,
    });

    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "bstock",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    const run = await runGuardianEvaluation(ctx);
    expect(run.generatedAlerts).toBe(0);

    const pauseFailureWarning = warnings.find((w) => w.startsWith("pauseState failed for"));
    expect(pauseFailureWarning).toBeDefined();
    expect(pauseFailureWarning).toContain("[redacted url]");
    expect(pauseFailureWarning).not.toContain("https://");
    expect(pauseFailureWarning).not.toContain("SECRET_KEY_999");
  });
  it("honours a saved rule toggle, quiet hours, and cooldown from guardian-settings", async () => {
    const store = openStore(":memory:");
    let currentTime = 1_000_000;
    const warnings: string[] = [];
    const ctx: GuardianJobContext = {
      store,
      health: store.health,
      now: () => currentTime,
      onWarn: (msg) => warnings.push(msg),
      isProduction: false,
    };

    // Active wallet
    store.put({
      kind: "wallet:active",
      key: "bsc",
      data: { address: wallet },
      source: "test",
      observedAt: currentTime,
    });

    // Portfolio with NVDA holding
    store.put({
      kind: "portfolio",
      key: wallet,
      data: {
        holdings: [
          {
            tokenContractAddress: nvdaAddr,
            ticker: "NVDA",
            issuer: "ondo",
            balanceTokens: 10n * 10n ** 18n,
            balanceShares: 10n * 10n ** 18n,
            isRecognized: true,
          },
        ],
      },
      source: "statement",
      observedAt: currentTime,
    });

    // Telegram link so delivery works
    store.put({
      kind: "guardian-link",
      key: wallet,
      data: { walletAddress: wallet, chatId: 123, linkedAt: currentTime, alertsEnabled: true },
      source: "test",
      observedAt: currentTime,
    });

    // Baseline radar (Grade B, not paused)
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "B",
        reasons: [],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    // Baseline run
    await runGuardianEvaluation(ctx);

    // Save custom settings: disable gradeDrop, set quiet hours to block 0-23 UTC (i.e. all hours), cooldown 7 days
    store.put({
      kind: "guardian-settings",
      key: wallet,
      source: "web-session",
      observedAt: currentTime,
      data: {
        enabled: true,
        rules: {
          ...{
            paused: true,
            shareCount: true,
            gradeDrop: true,
            ghost: true,
            priceThreshold: true,
            earnings: false,
          },
          gradeDrop: false,
        },
        quietHours: { enabled: true, startHourUtc: 0, endHourUtc: 23 },
        cooldownMs: 604_800_000,
      },
    });

    // Advance time and drop grade
    currentTime += 60_000;
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "F",
        reasons: ["bad"],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    // Since gradeDrop is false, it shouldn't generate an alert for grade drop.
    const run2 = await runGuardianEvaluation(ctx);
    expect(run2.generatedAlerts).toBe(0);

    // Now turn gradeDrop back on, but we still have quiet hours (all hours blocked)
    store.put({
      kind: "guardian-settings",
      key: wallet,
      source: "web-session",
      observedAt: currentTime,
      data: {
        enabled: true,
        rules: {
          ...{
            paused: true,
            shareCount: true,
            gradeDrop: true,
            ghost: true,
            priceThreshold: true,
            earnings: false,
          },
          gradeDrop: true,
        },
        quietHours: { enabled: true, startHourUtc: 0, endHourUtc: 23 }, // blocks delivery
        cooldownMs: 604_800_000,
      },
    });

    const run3 = await runGuardianEvaluation(ctx);
    expect(run3.generatedAlerts).toBe(1); // generates alert
    const alerts = store.latest<Alert[]>("alerts", wallet, { maxAgeMs: 600_000 })?.data ?? [];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.deliveredAt).toBeUndefined(); // Delivery suppressed by quiet hours
    expect(alerts[0]!.deliverAt).toBeGreaterThan(currentTime); // Should have a future deliverAt set

    // Advance 2 days. The grade stays F, so the alert condition persists.
    currentTime += 2 * 86_400_000;
    store.put({
      kind: "radar",
      key: nvdaAddr,
      data: {
        ticker: "NVDA",
        address: nvdaAddr,
        issuer: "ondo",
        grade: "F",
        reasons: ["bad"],
        ghost: false,
      } as RadarSnapshotSubset,
      source: "radar",
      observedAt: currentTime,
    });

    const run4 = await runGuardianEvaluation(ctx);
    // Because cooldown is 7 days, it should NOT generate another alert yet!
    expect(run4.generatedAlerts).toBe(0);
  });
});
