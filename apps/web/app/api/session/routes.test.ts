import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { NextRequest } from "next/server";
import { GET as feedGET } from "./guardian/feed/route";
import { GET as settingsGET } from "./guardian/settings/route";
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
  let mockStore: any;
  return {
    ...actual,
    openStore: () => {
      if (!mockStore) {
        const snapshots: any[] = [];
        mockStore = {
          close: vi.fn(),
          latest: vi.fn().mockReturnValue(null),
          history: vi.fn().mockImplementation((kind, key) => {
            return snapshots.filter(s => s.kind === kind && s.key === key);
          }),
          put: vi.fn().mockImplementation((s) => {
            snapshots.push(s);
          }),
        };
      }
      return mockStore;
    },
    __resetMockStore: () => { mockStore = null; },
  };
});

describe("session routes", () => {
  const MY_WALLET = "0x1111111111111111111111111111111111111111";
  const VICTIM = "0x9999999999999999999999999999999999999999";

  beforeEach(() => {
    vi.useFakeTimers();
    clearUserRateLimits();
    process.env.TALLY_TEST_SESSION_WALLET = MY_WALLET;
    process.env.TEST_FLAG_GUARDIAN = "1";
    process.env.TEST_FLAG_STATEMENT = "1";
    // @ts-ignore
    modkit.__resetMockStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TALLY_TEST_SESSION_WALLET;
    delete process.env.TEST_FLAG_GUARDIAN;
    delete process.env.TEST_FLAG_STATEMENT;
  });

  function makeReq(url: string, method: string, headers?: Record<string, string>, body?: any) {
    const init: RequestInit = { method };
    if (headers) init.headers = new Headers(headers);
    if (body) init.body = JSON.stringify(body);
    return new NextRequest("http://localhost" + url, init as any);
  }

  it("spoof test: ignores query, cookie, body, and relies on verified wallet", async () => {
    // Send victim in query, cookie, body, but no x-tally-wallet (meaning we get MY_WALLET via test env)
    const req = new NextRequest(`http://localhost/api/session/guardian/feed?address=${VICTIM}`, {
      method: "GET",
      headers: {
        cookie: `walletAddress=${VICTIM}`,
      },
    } as any);
    // @ts-ignore NextRequest allows body on GET in test but let's just test query and cookie for GET
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
