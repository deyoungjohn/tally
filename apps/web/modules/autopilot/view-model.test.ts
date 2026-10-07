import { E18 } from "@tally/core";
import { appendDecisionRows } from "@tally/mod-autopilot";
import { openStore, type OpenSnapshotStore } from "@tally/modkit";
import { afterEach, expect, it, vi } from "vitest";
import {
  constructedPolicy,
  constructedRow,
  CONSTRUCTED_NOW as now,
  CONSTRUCTED_WALLET as wallet,
} from "../../../../packages/mod-autopilot/src/fixtures";
import { BACKSTOP_BANNER, loadAutopilot, SHADOW_LABEL } from "./view-model";

const stores: OpenSnapshotStore[] = [];
function seeded() {
  const store = openStore(":memory:");
  stores.push(store);
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy(),
    source: "constructed",
    observedAt: now,
  });
  appendDecisionRows(store, [constructedRow()], now);
  return store;
}
afterEach(() => stores.splice(0).forEach((s) => s.close()));
it("empty view model explains missing observations and has honest defaults", async () => {
  const vm = await loadAutopilot({ walletAddress: wallet, now });
  expect(vm).toMatchObject({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    error: null,
    spentToday: "0",
    rows: [],
    armedRules: {},
    caps: { perTrade: "25", daily: "50", perTradeCeiling: "100", dailyCeiling: "250" },
    banner: BACKSTOP_BANNER,
  });
  expect(vm.reason).toBe("Autopilot has no observations yet.");
  expect((await loadAutopilot()).reason).toContain("Connect your wallet");
});
it("ready view model labels shadow rows, spends zero, and displays clamped caps", async () => {
  const store = seeded();
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy({ perTradeCap: 999n * E18, dailyCap: 999n * E18, killSwitch: true }),
    source: "constructed",
    observedAt: now,
  });
  const vm = await loadAutopilot({ walletAddress: wallet, store, now });
  expect(vm).toMatchObject({
    state: "ready",
    stale: false,
    spentToday: "0",
    killSwitch: true,
    caps: { perTrade: "100", daily: "250" },
    armedRules: { "grade-drop": { atOrBelow: "D" } },
  });
  expect(vm.rows[0]).toMatchObject({
    label: SHADOW_LABEL,
    mode: "shadow",
    tokens: "1",
    usdCap: "10",
    receiptId: null,
  });
  expect(vm.walletLimit).toContain("chief engineer");
});
it("stale view model retains last good rows with age and source", async () => {
  const store = seeded();
  expect(await loadAutopilot({ walletAddress: wallet, store, now: now + 180_001 })).toMatchObject({
    state: "stale",
    stale: true,
    ageMs: 180_001,
    source: "autopilot:shadow",
    rows: [expect.objectContaining({ label: SHADOW_LABEL })],
  });
});
it("quiet log stays current with fresh worker health; failed health preserves rows", async () => {
  const store = seeded();
  const health = { health: null, degraded: false, stale: false, ageMs: 10, reason: null };
  expect(
    await loadAutopilot({ walletAddress: wallet, store, now: now + 180_001, health }),
  ).toMatchObject({ state: "ready", stale: false, ageMs: 10 });
  expect(
    await loadAutopilot({
      walletAddress: wallet,
      store,
      now,
      health: { ...health, degraded: true, reason: "primary source failed" },
    }),
  ).toMatchObject({
    state: "error",
    error: "primary source failed",
    rows: [expect.objectContaining({ label: SHADOW_LABEL })],
  });
});
it("errors warn and return an error state without claiming a fresh observation", async () => {
  const store = seeded();
  vi.spyOn(store, "history").mockImplementation(() => {
    throw new Error("store down");
  });
  const onWarn = vi.fn();
  expect(await loadAutopilot({ walletAddress: wallet, store, now, onWarn })).toMatchObject({
    state: "error",
    source: null,
    ageMs: null,
  });
  expect(onWarn).toHaveBeenCalled();
});
it("wallet isolation never exposes another wallet's rows or observation metadata", async () => {
  expect(
    await loadAutopilot({ walletAddress: "other-wallet", store: seeded(), now }),
  ).toMatchObject({ state: "empty", rows: [], source: null, ageMs: null, spentToday: "0" });
});
it("shadow refusals do not claim a hypothetical sale; live receipt-backed spend rolls over", async () => {
  const store = seeded();
  appendDecisionRows(
    store,
    [
      constructedRow({
        alertId: "refused",
        decision: "alertOnly",
        reasons: ["kill switch on"],
        leg: undefined,
      }),
      constructedRow({
        alertId: "live",
        mode: "live",
        receiptId: "constructed-receipt",
        executedUsd: 6n * E18,
        executedAt: now,
      }),
    ],
    now,
  );
  const vm = await loadAutopilot({ walletAddress: wallet, store, now });
  expect(vm.rows.find((r) => r.alertId === "refused")?.label).toBe(
    "shadow alert only; nothing was executed",
  );
  expect(vm.spentToday).toBe("6");
  expect(
    (await loadAutopilot({ walletAddress: wallet, store, now: Date.UTC(2026, 9, 7) })).spentToday,
  ).toBe("0");
});

it("another wallet's newer batch does not refresh this wallet's log age", async () => {
  const store = seeded();
  appendDecisionRows(
    store,
    [
      constructedRow({
        alertId: "new-other-wallet",
        walletAddress: "other-wallet",
        decidedAt: now + 180_001,
      }),
    ],
    now + 180_001,
  );
  expect(await loadAutopilot({ walletAddress: wallet, store, now: now + 180_001 })).toMatchObject({
    state: "stale",
    ageMs: 180_001,
  });
});

it("policy is editable only with explicit verified-session proof, never an address alone", async () => {
  const store = seeded();
  const readOnly = await loadAutopilot({ walletAddress: wallet, store, now });
  expect(readOnly.policyEditable).toBe(false);
  expect(readOnly.policy).toMatchObject({ perTradeCap: "25", dailyCap: "50", killSwitch: false });
  expect(
    (await loadAutopilot({ walletAddress: wallet, store, now, verifiedSession: true }))
      .policyEditable,
  ).toBe(true);
  expect((await loadAutopilot({ store, now, verifiedSession: true })).policyEditable).toBe(false);
});
it("collector distinguishes never collected, empty, current and stale, preserving positions and age", async () => {
  const store = seeded();
  expect((await loadAutopilot({ walletAddress: wallet, store, now })).collector).toEqual({
    state: "never collected",
    ageMs: null,
  });
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy({ tokenAllowList: [] }),
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "autopilot-collector",
    key: wallet,
    data: { positionKeys: [] },
    source: "constructed",
    observedAt: now,
  });
  expect((await loadAutopilot({ walletAddress: wallet, store, now })).collector).toEqual({
    state: "empty",
    ageMs: 0,
  });
  const token = "0x0000000000000000000000000000000000000002";
  store.put({
    kind: "autopilot-policy",
    key: wallet,
    data: constructedPolicy(),
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "autopilot-position",
    key: `${wallet}:${token}`,
    data: constructedRow().inputs.position,
    source: "constructed",
    observedAt: now,
  });
  store.put({
    kind: "autopilot-collector",
    key: wallet,
    data: { positionKeys: [`${wallet}:${token}`] },
    source: "constructed",
    observedAt: now,
  });
  expect(await loadAutopilot({ walletAddress: wallet, store, now })).toMatchObject({
    collector: { state: "ok", ageMs: 0 },
    positions: [{ token, shares: "100", usdValue: "100", ageMs: 0, stale: false }],
  });
  expect(await loadAutopilot({ walletAddress: wallet, store, now: now + 60_001 })).toMatchObject({
    collector: { state: "stale", ageMs: 60_001 },
    positions: [{ shares: "100", stale: true, ageMs: 60_001 }],
  });
});
it("unknown position facts carry their warnings without invented amounts", async () => {
  const store = seeded();
  const p = constructedRow().inputs.position!;
  store.put({
    kind: "autopilot-position",
    key: `${wallet}:${p.tokenAddress}`,
    data: { ...p, shares: null, usdPerShare: null, warnings: ["unknown multiplier"] },
    source: "constructed",
    observedAt: now,
  });
  expect((await loadAutopilot({ walletAddress: wallet, store, now })).positions).toMatchObject([
    { shares: null, usdValue: null, warnings: ["unknown multiplier"] },
  ]);
});
