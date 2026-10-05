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

    // Check Finding 4 exact wording
    expect(
      warnings.some((w) =>
        w.includes("bStock pause alerts are inactive until engine.pauseState lands"),
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
});
