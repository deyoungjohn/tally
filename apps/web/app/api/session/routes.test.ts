import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { GET as feedGET } from "./guardian/feed/route";

import { POST as linkCodePOST } from "./guardian/link-code/route";
import { POST as activeWalletPOST } from "./active-wallet/route";
import { clearUserRateLimits } from "../../../lib/server/session";

import * as modkit from "@tally/modkit";

// We need to mock moduleFlags
vi.mock("../../../lib/flags", () => ({
  moduleFlags: () => ({
    guardian: process.env.TEST_FLAG_GUARDIAN !== "0",
    statement: process.env.TEST_FLAG_STATEMENT !== "0",
  }),
}));

vi.mock("@tally/modkit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tally/modkit")>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockStore: any;
  return {
    ...actual,
    openStore: () => {
      if (!mockStore) {
        const snapshots: Array<{ kind: string; key: string; data: unknown; source: string }> = [];
        mockStore = {
          close: vi.fn(),
          latest: vi
            .fn()
            .mockImplementation((kind: string, key: string, opts?: { maxAgeMs: number }) => {
              // The real store rejects an infinite or negative age; a route that passes one fails with a 500 in production.
              if (opts && (!Number.isFinite(opts.maxAgeMs) || opts.maxAgeMs < 0))
                throw new RangeError("maxAgeMs must be nonnegative and finite");
              const hist = snapshots.filter((s) => s.kind === kind && s.key === key);
              return hist.length > 0 ? hist[hist.length - 1] : null;
            }),
          history: vi.fn().mockImplementation((kind: string, key: string) => {
            return snapshots.filter((s) => s.kind === kind && s.key === key);
          }),
          put: vi.fn().mockImplementation((s) => {
            snapshots.push(s);
          }),
          health: {
            get: vi.fn().mockReturnValue(null),
          },
        };
      }
      return mockStore;
    },
    __resetMockStore: () => {
      mockStore = null;
    },
  };
});

describe("session routes", () => {
  const MY_WALLET = "0x1111111111111111111111111111111111111111";
  const VICTIM = "0x9999999999999999999999999999999999999999";

  beforeEach(() => {
    vi.useFakeTimers();
    clearUserRateLimits();
    process.env.TALLY_TEST_SESSION_WALLET = MY_WALLET;
    process.env.TALLY_FIXTURES = "1";
    process.env.TEST_FLAG_GUARDIAN = "1";
    process.env.TEST_FLAG_STATEMENT = "1";
    // @ts-expect-error -- mock function
    modkit.__resetMockStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TALLY_TEST_SESSION_WALLET;
    delete process.env.TALLY_FIXTURES;
    delete process.env.TEST_FLAG_GUARDIAN;
    delete process.env.TEST_FLAG_STATEMENT;
  });

  function makeReq(url: string, method: string, headers?: Record<string, string>, body?: unknown) {
    const init: RequestInit = { method };
    if (headers) init.headers = new Headers(headers);
    if (body) init.body = JSON.stringify(body);

    return new NextRequest("http://localhost" + url, init as unknown as Request);
  }

  it("spoof test: ignores query, cookie, body, and relies on verified wallet", async () => {
    // Send victim in query, cookie, body, but no x-tally-wallet (meaning we get MY_WALLET via test env)
    const req = new NextRequest(`http://localhost/api/session/guardian/feed?address=${VICTIM}`, {
      method: "GET",
      headers: {
        cookie: `walletAddress=${VICTIM}`,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await feedGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.walletAddress).toBe(MY_WALLET);
  });

  it("unverified returns no data / 401", async () => {
    // Break the test session wallet
    delete process.env.TALLY_TEST_SESSION_WALLET;
    const req = makeReq("/api/session/guardian/feed", "GET");
    const res = await feedGET(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error.kind).toBe("session_required");
  });

  it("flag off returns 404", async () => {
    process.env.TEST_FLAG_GUARDIAN = "0";
    const req = makeReq("/api/session/guardian/feed", "GET");
    const res = await feedGET(req);
    expect(res.status).toBe(404);
  });

  it("link-code rate limit trips", async () => {
    let res;
    for (let i = 0; i < 5; i++) {
      const req = makeReq("/api/session/guardian/link-code", "POST");
      res = await linkCodePOST(req);
      expect(res.status).toBe(200);
    }
    // 6th should fail
    const req = makeReq("/api/session/guardian/link-code", "POST");
    res = await linkCodePOST(req);
    expect(res.status).toBe(429);
  });

  it("active-wallet writes exactly one snapshot and is idempotent within 24h", async () => {
    let req = makeReq("/api/session/active-wallet", "POST");
    let res = await activeWalletPOST(req);
    expect(res.status).toBe(204);

    const store = modkit.openStore();
    expect(store.put).toHaveBeenCalledTimes(1);

    // Call again immediately
    req = makeReq("/api/session/active-wallet", "POST");
    res = await activeWalletPOST(req);
    expect(res.status).toBe(204);

    // Still only 1 put call because of 24h idempotency
    expect(store.put).toHaveBeenCalledTimes(1);

    // Advance 25 hours
    await vi.advanceTimersByTimeAsync(25 * 3600 * 1000);

    // rate limit of 60_000ms is passed too
    req = makeReq("/api/session/active-wallet", "POST");
    res = await activeWalletPOST(req);
    expect(res.status).toBe(204);

    // Now it should be 2
    expect(store.put).toHaveBeenCalledTimes(2);
  });
});

import { PUT as settingsPUT, GET as settingsGET } from "./guardian/settings/route";
import { DEFAULT_GUARDIAN_SETTINGS } from "@tally/mod-guardian";

describe("Guardian settings write route", () => {
  const MY_WALLET = "0x1111111111111111111111111111111111111111";

  beforeEach(() => {
    vi.useFakeTimers();
    clearUserRateLimits();
    process.env.TALLY_TEST_SESSION_WALLET = MY_WALLET;
    process.env.TALLY_FIXTURES = "1";
    process.env.TEST_FLAG_GUARDIAN = "1";
    // @ts-expect-error -- mock function
    modkit.__resetMockStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeReq(url: string, method: string, headers?: Record<string, string>, body?: unknown) {
    const init: RequestInit = { method };
    if (headers) init.headers = new Headers(headers);
    if (body) init.body = JSON.stringify(body);
    return new NextRequest("http://localhost" + url, init as unknown as Request);
  }

  it("spoof test: PUT ignores query/cookie and relies on verified wallet", async () => {
    const store = modkit.openStore();
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          ticker: "NVDA",
          underlyingTicker: "NVDA",
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          name: "NVDA Stock",
          provider: "test",
        },
      ],
      source: "test",
      observedAt: Date.now(),
    });

    const req = makeReq(
      `/api/session/guardian/settings?address=0x999`,
      "PUT",
      { cookie: "walletAddress=0x999" },
      DEFAULT_GUARDIAN_SETTINGS,
    );
    const res = await settingsPUT(req);
    expect(res.status).toBe(200);

    // Check put was called with MY_WALLET
    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({
        key: MY_WALLET.toLowerCase(),
        kind: "guardian-settings",
        source: "web-session",
      }),
    );
  });

  it("flag off returns 404 on PUT", async () => {
    process.env.TEST_FLAG_GUARDIAN = "0";
    const req = makeReq("/api/session/guardian/settings", "PUT", {}, DEFAULT_GUARDIAN_SETTINGS);
    const res = await settingsPUT(req);
    expect(res.status).toBe(404);
  });

  it("rejects unknown fields in PUT", async () => {
    const store = modkit.openStore();
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          ticker: "NVDA",
          underlyingTicker: "NVDA",
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          name: "NVDA Stock",
          provider: "test",
        },
      ],
      source: "test",
      observedAt: Date.now(),
    });

    const req = makeReq(
      "/api/session/guardian/settings",
      "PUT",
      {},
      { ...DEFAULT_GUARDIAN_SETTINGS, badField: true },
    );
    const res = await settingsPUT(req);
    expect(res.status).toBe(400);
    const text = await res.json();
    expect(text.error.message).toContain("Unrecognized key(s) in object: 'badField'");
  });

  it("rejects earnings: true", async () => {
    const store = modkit.openStore();
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          ticker: "NVDA",
          underlyingTicker: "NVDA",
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          name: "NVDA Stock",
          provider: "test",
        },
      ],
      source: "test",
      observedAt: Date.now(),
    });

    const body = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      rules: { ...DEFAULT_GUARDIAN_SETTINGS.rules, earnings: true },
    };
    const req = makeReq("/api/session/guardian/settings", "PUT", {}, body);
    const res = await settingsPUT(req);
    expect(res.status).toBe(400);
    const text = await res.json();
    expect(text.error.message).toContain("No earnings-date source is available yet");
  });

  it("rejects bad thresholds and hours", async () => {
    const store = modkit.openStore();
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          ticker: "NVDA",
          underlyingTicker: "NVDA",
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          name: "NVDA Stock",
          provider: "test",
        },
      ],
      source: "test",
      observedAt: Date.now(),
    });

    // bad threshold (min > max)
    const body1 = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      priceThresholds: { NVDA: { minPriceUsd: 10, maxPriceUsd: 5 } },
    };
    const res1 = await settingsPUT(makeReq("/api/session/guardian/settings", "PUT", {}, body1));
    expect(res1.status).toBe(400);

    // bad hours
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          ticker: "NVDA",
          underlyingTicker: "NVDA",
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          name: "NVDA Stock",
          provider: "test",
        },
      ],
      source: "test",
      observedAt: Date.now(),
    });
    const body2 = {
      ...DEFAULT_GUARDIAN_SETTINGS,
      quietHours: { enabled: true, startHourUtc: 24, endHourUtc: -1 },
    };
    const res2 = await settingsPUT(makeReq("/api/session/guardian/settings", "PUT", {}, body2));
    expect(res2.status).toBe(400);
  });

  it("cooldown bounds check", async () => {
    const store = modkit.openStore();

    // too small
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          ticker: "NVDA",
          underlyingTicker: "NVDA",
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          name: "NVDA Stock",
          provider: "test",
        },
      ],
      source: "test",
      observedAt: Date.now(),
    });
    const body1 = { ...DEFAULT_GUARDIAN_SETTINGS, cooldownMs: 0 };
    const res1 = await settingsPUT(makeReq("/api/session/guardian/settings", "PUT", {}, body1));
    expect(res1.status).toBe(400);

    // too big
    store.put({
      kind: "registry",
      key: "bsc",
      data: [
        {
          ticker: "NVDA",
          underlyingTicker: "NVDA",
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          name: "NVDA Stock",
          provider: "test",
        },
      ],
      source: "test",
      observedAt: Date.now(),
    });
    const body2 = { ...DEFAULT_GUARDIAN_SETTINGS, cooldownMs: 700_000_000 };
    const res2 = await settingsPUT(makeReq("/api/session/guardian/settings", "PUT", {}, body2));
    expect(res2.status).toBe(400);
  });

  it("rate limit trips for PUT", async () => {
    let res;
    const store = modkit.openStore();
    for (let i = 0; i < 30; i++) {
      store.put({
        kind: "registry",
        key: "bsc",
        data: [
          {
            ticker: "NVDA",
            underlyingTicker: "NVDA",
            address: "0x0000000000000000000000000000000000000000",
            decimals: 18,
            name: "NVDA Stock",
            provider: "test",
          },
        ],
        source: "test",
        observedAt: Date.now(),
      });
      const req = makeReq(
        "/api/session/guardian/settings",
        "PUT",
        { "x-forwarded-for": "rate-limit-test" },
        DEFAULT_GUARDIAN_SETTINGS,
      );
      res = await settingsPUT(req);
      expect(res.status).toBe(200);
    }
    // 31st should fail
    const req = makeReq(
      "/api/session/guardian/settings",
      "PUT",
      { "x-forwarded-for": "rate-limit-test" },
      DEFAULT_GUARDIAN_SETTINGS,
    );
    res = await settingsPUT(req);
    expect(res.status).toBe(429);
  });

  it("returns saved setting on GET", async () => {
    const store = modkit.openStore();
    // Simulate that store.latest("guardian-settings") will return our saved data
    (store.latest as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (kind: string, key: string) => {
        if (kind === "guardian-settings" && key === MY_WALLET.toLowerCase()) {
          return { data: { ...DEFAULT_GUARDIAN_SETTINGS, cooldownMs: 999999 } };
        }
        return null;
      },
    );

    const req = makeReq("/api/session/guardian/settings", "GET");
    const res = await settingsGET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.settings.cooldownMs).toBe(999999);
  });
});
