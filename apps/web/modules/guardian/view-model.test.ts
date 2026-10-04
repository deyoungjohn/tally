import { describe, expect, it } from "vitest";
import { openStore } from "@tally/modkit";
import { createLinkCode, type Alert, type GuardianLinkData } from "@tally/mod-guardian";
import { loadAlertFeed, loadGuardian, loadGuardianSettings } from "./view-model";

describe("Guardian View Models (apps/web/modules/guardian)", () => {
  it("empty feed explains missing observations and never claims live source", async () => {
    const vm = await loadAlertFeed();
    expect(vm).toEqual({
      state: "empty",
      walletAddress: null,
      alerts: [],
      totalCount: 0,
      stale: false,
      ageMs: null,
      source: null,
      reason: "Connect your wallet to view Guardian alerts.",
      error: null,
    });
  });

  it("loads populated alert feed with formatted items and staleness", async () => {
    const store = openStore(":memory:");
    const wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930";
    const now = 1_000_000;

    const alert1: Alert = {
      id: `paused:${wallet}:0xnvdab:1000`,
      walletAddress: wallet,
      rule: "paused",
      ticker: "NVDA",
      issuer: "bstock",
      severity: "warning",
      title: "NVDA via bStock is paused",
      body: "NVDA via bStock is paused by its pause manager.",
      evidence: {
        snapshotKind: "status",
        snapshotKey: "0xnvdab",
        observedAt: now - 30_000,
      },
      createdAt: now - 30_000,
    };

    const alert2: Alert = {
      id: `price-threshold:max:${wallet}:0xnvdaon:2000`,
      walletAddress: wallet,
      rule: "price-threshold",
      ticker: "NVDA",
      issuer: "ondo",
      severity: "info",
      title: "NVDA rose above $240.00",
      body: "NVDA per-share price is $245.00, above your threshold.",
      direction: "max",
      evidence: {
        snapshotKind: "price",
        snapshotKey: "0xnvdaon",
        observedAt: now,
      },
      createdAt: now,
    };

    store.put({
      kind: "alerts",
      key: wallet,
      data: [alert1, alert2],
      source: "guardian-job",
      observedAt: now,
    });

    const vm = await loadAlertFeed({ walletAddress: wallet, store, now: now + 5000 });
    expect(vm.state).toBe("ready");
    expect(vm.walletAddress).toBe(wallet);
    expect(vm.totalCount).toBe(2);
    expect(vm.alerts).toHaveLength(2);
    // Newest first
    expect(vm.alerts[0]!.id).toBe(alert2.id);
    expect(vm.alerts[0]!.direction).toBe("max");
    expect(vm.alerts[1]!.id).toBe(alert1.id);
    expect(vm.stale).toBe(false);

    // Test stale snapshot (>24h)
    const staleVm = await loadAlertFeed({
      walletAddress: wallet,
      store,
      now: now + 100_000_000,
    });
    expect(staleVm.stale).toBe(true);
    expect(staleVm.ageMs).toBe(100_000_000);
  });

  it("loads settings for unlinked wallet and displays generated link code", async () => {
    const store = openStore(":memory:");
    const wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930";
    const now = 1_000_000;

    // Issue link code
    const { code } = createLinkCode(store, wallet, now);

    const vm = await loadGuardianSettings({ walletAddress: wallet, store, now: now + 2000 });
    expect(vm.state).toBe("ready");
    expect(vm.walletAddress).toBe(wallet);
    expect(vm.telegram.linked).toBe(false);
    expect(vm.telegram.activeLinkCode).not.toBeNull();
    expect(vm.telegram.activeLinkCode?.code).toBe(code);
    expect(vm.telegram.activeLinkCode?.expiresInSeconds).toBeGreaterThan(0);
  });

  it("loads settings for linked wallet and displays chat id and alert toggle", async () => {
    const store = openStore(":memory:");
    const wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930";
    const now = 1_000_000;

    // Set link snapshot
    const linkData: GuardianLinkData = {
      walletAddress: wallet,
      chatId: 777888,
      linkedAt: now,
      alertsEnabled: true,
      quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 7 },
    };
    store.put({
      kind: "guardian-link",
      key: wallet,
      data: linkData,
      source: "guardian-bot",
      observedAt: now,
    });

    const vm = await loadGuardianSettings({ walletAddress: wallet, store, now: now + 5000 });
    expect(vm.state).toBe("ready");
    expect(vm.telegram.linked).toBe(true);
    expect(vm.telegram.chatId).toBe(777888);
    expect(vm.telegram.alertsEnabled).toBe(true);
    expect(vm.telegram.quietHours).toEqual({
      enabled: true,
      startHourUtc: 22,
      endHourUtc: 7,
    });
  });

  it("combined loadGuardian loader merges feed and settings cleanly", async () => {
    const store = openStore(":memory:");
    const wallet = "0x2bf7edf53bc6be6ff98f149387f3818ce28d2930";

    const vm = await loadGuardian({ walletAddress: wallet, store });
    expect(vm.state).toBe("ready");
    expect(vm.feed.walletAddress).toBe(wallet);
    expect(vm.settings.walletAddress).toBe(wallet);
  });
});
