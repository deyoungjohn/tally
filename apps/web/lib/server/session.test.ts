import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSessionVerifier,
  clearSessionCache,
  rateLimitedUser,
  clearUserRateLimits,
} from "./session";

describe("session verification", () => {
  beforeEach(() => {
    clearSessionCache();
    clearUserRateLimits();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockAppId = "test-app-id";

  function makeReq(authHeader?: string) {
    const headers = new Headers();
    if (authHeader) headers.set("authorization", authHeader);
    return { headers } as unknown as Request;
  }

  function mockPrivyClient(opts: {
    verifyResult?: { appId: string; userId: string } | null;
    verifyThrows?: boolean;
    verifyDelay?: number;
    userResult?: { id?: string; linked_accounts: Array<{ address: string; type?: string } | null | string> } | null;
    userThrows?: boolean;
    userDelay?: number;
  }) {
    return {
      utils: () => ({
        auth: () => ({
          verifyAccessToken: async (_token: string) => {
            if (opts.verifyDelay) await new Promise((r) => setTimeout(r, opts.verifyDelay));
            if (opts.verifyThrows) throw new Error("verify failed");
            return opts.verifyResult ?? { appId: mockAppId, userId: "user-123" };
          },
        }),
      }),
      users: () => ({
        _get: async (userId: string) => {
          if (opts.userDelay) await new Promise((r) => setTimeout(r, opts.userDelay));
          if (opts.userThrows) throw new Error("user get failed");
          return (
            opts.userResult ?? {
              id: userId,
              linked_accounts: [
                { type: "wallet", address: "0x1111111111111111111111111111111111111111" },
              ],
            }
          );
        },
      }),
    };
  }

  it("valid token and linked wallet passes", async () => {
    const client = mockPrivyClient({});
    const verify = createSessionVerifier({ client, appId: mockAppId });
    const res = await verify(makeReq("Bearer valid-token"));
    expect(res).toBe("0x1111111111111111111111111111111111111111");
  });

  it("wrong app id returns null", async () => {
    const client = mockPrivyClient({ verifyResult: { appId: "wrong-app", userId: "user-123" } });
    const verify = createSessionVerifier({ client, appId: mockAppId });
    const res = await verify(makeReq("Bearer valid-token"));
    expect(res).toBeNull();
  });

  it("expired or invalid token throws, returning null", async () => {
    const client = mockPrivyClient({ verifyThrows: true });
    const verify = createSessionVerifier({ client, appId: mockAppId });
    const res = await verify(makeReq("Bearer invalid"));
    expect(res).toBeNull();
  });

  it("missing or malformed header returns null", async () => {
    const client = mockPrivyClient({});
    const verify = createSessionVerifier({ client, appId: mockAppId });
    expect(await verify(makeReq())).toBeNull();
    expect(await verify(makeReq("Basic abc"))).toBeNull();
  });

  it("chosen wallet not linked returns null", async () => {
    const client = mockPrivyClient({});
    const verify = createSessionVerifier({ client, appId: mockAppId });
    const res = await verify(makeReq("Bearer valid"), "0x2222222222222222222222222222222222222222");
    expect(res).toBeNull();
  });

  it("no chosen with several linked wallets returns null", async () => {
    const client = mockPrivyClient({
      userResult: {
        id: "user-123",
        linked_accounts: [
          { type: "wallet", address: "0x1111111111111111111111111111111111111111" },
          { type: "wallet", address: "0x2222222222222222222222222222222222222222" },
        ],
      },
    });
    const verify = createSessionVerifier({ client, appId: mockAppId });
    const res = await verify(makeReq("Bearer valid"));
    expect(res).toBeNull();
  });

  it("chosen wallet correctly selects among several linked wallets", async () => {
    const client = mockPrivyClient({
      userResult: {
        id: "user-123",
        linked_accounts: [
          { type: "wallet", address: "0x1111111111111111111111111111111111111111" },
          { type: "wallet", address: "0x2222222222222222222222222222222222222222" },
        ],
      },
    });
    const verify = createSessionVerifier({ client, appId: mockAppId });
    const res = await verify(makeReq("Bearer valid"), "0x2222222222222222222222222222222222222222");
    expect(res).toBe("0x2222222222222222222222222222222222222222");
  });

  it("privy client user fetch throws, returns null", async () => {
    const client = mockPrivyClient({ userThrows: true });
    const verify = createSessionVerifier({ client, appId: mockAppId });
    const res = await verify(makeReq("Bearer valid"));
    expect(res).toBeNull();
  });

  it("privy client times out", async () => {
    const client = mockPrivyClient({ verifyDelay: 6000 });
    const verify = createSessionVerifier({ client, appId: mockAppId });

    // Fire off the verify call
    const promise = verify(makeReq("Bearer valid"));

    // Advance timers so timeout throws
    await vi.advanceTimersByTimeAsync(5000);
    const res = await promise;
    expect(res).toBeNull();
  });

  it("cache hit does not call Privy twice", async () => {
    let getCalls = 0;
    const client = {
      utils: () => ({
        auth: () => ({
          verifyAccessToken: async () => ({ appId: mockAppId, userId: "user-123" }),
        }),
      }),
      users: () => ({
        _get: async () => {
          getCalls++;
          return { linked_accounts: [{ address: "0x1111111111111111111111111111111111111111" }] };
        },
      }),
    };
    let time = 1000;
    const verify = createSessionVerifier({ client, appId: mockAppId, now: () => time });

    expect(await verify(makeReq("Bearer valid"))).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(getCalls).toBe(1);

    time = 2000;
    expect(await verify(makeReq("Bearer valid2"))).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(getCalls).toBe(1); // cached

    time = 1000 + 60001;
    expect(await verify(makeReq("Bearer valid3"))).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(getCalls).toBe(2); // cache expired
  });

  it("cache is bounded", async () => {
    let getCalls = 0;
    const client = {
      utils: () => ({
        auth: () => ({
          verifyAccessToken: async (token: string) => ({ appId: mockAppId, userId: token }),
        }),
      }),
      users: () => ({
        _get: async () => {
          getCalls++;
          return { linked_accounts: [{ address: "0x1111111111111111111111111111111111111111" }] };
        },
      }),
    };
    const verify = createSessionVerifier({ client, appId: mockAppId });

    for (let i = 0; i < 505; i++) {
      await verify(makeReq(`Bearer user${i}`));
    }
    expect(getCalls).toBe(505);

    // Oldest should be evicted, re-requesting user0 should trigger a fetch
    getCalls = 0;
    await verify(makeReq(`Bearer user0`));
    expect(getCalls).toBe(1);

    // Newer ones still cached
    getCalls = 0;
    await verify(makeReq(`Bearer user504`));
    expect(getCalls).toBe(0);
  });

  it("captures console output and proves no token, secret or address is logged", async () => {
    const client = mockPrivyClient({ verifyThrows: true });
    const verify = createSessionVerifier({ client, appId: mockAppId });
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => {});

    await verify(makeReq("Bearer secret_token_xyz"));
    expect(warnMock).toHaveBeenCalledWith("session: error");

    const allArgs = warnMock.mock.calls.flat().join(" ");
    expect(allArgs).not.toContain("secret_token_xyz");
    expect(allArgs).not.toContain("0x1111");
  });

  it("test-session override cannot be switched on when NODE_ENV=production", async () => {
    process.env.TALLY_TEST_SESSION_WALLET = "0x9999999999999999999999999999999999999999";

    const client = mockPrivyClient({});
    const verify = createSessionVerifier({ client, appId: mockAppId });

    // In test environment, override works
    vi.stubEnv("NODE_ENV", "test");
    expect(await verify(makeReq("Bearer ignored"))).toBe(
      "0x9999999999999999999999999999999999999999",
    );

    // In production, it does not
    vi.stubEnv("NODE_ENV", "production");
    expect(await verify(makeReq("Bearer valid-token"))).toBe(
      "0x1111111111111111111111111111111111111111",
    );

    vi.unstubAllEnvs();
    delete process.env.TALLY_TEST_SESSION_WALLET;
  });

  it("rate limit trips after max hits", () => {
    let time = 1000;
    vi.setSystemTime(time);

    expect(rateLimitedUser("user1", "test", 2, 60000)).toBe(false);
    expect(rateLimitedUser("user1", "test", 2, 60000)).toBe(false);
    expect(rateLimitedUser("user1", "test", 2, 60000)).toBe(true);

    time = 62000;
    vi.setSystemTime(time);
    expect(rateLimitedUser("user1", "test", 2, 60000)).toBe(false); // window moved
  });
});
