import { expect, test, type Page } from "@playwright/test";
import { startVmServer, type VmServer } from "./vm-server";

/**
 * Guardian: private alerts for the signed-in wallet, through the session-verified routes. The real server (flag on, module
 * running) proves the page, the nav and the signed-out state; the session routes are stubbed so every state can be shown (the
 * production-mode server cannot verify a real Privy token, which is the point). A third server (flag on, no module update) shows
 * the degraded card; the default server (every flag off) proves the 404 and the missing nav item.
 */

const WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

async function mockWallet(page: Page) {
  await page.addInitScript((a) => {
    (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
      address: a,
      signedIn: true,
    };
  }, WALLET);
}

const feed = (over: Record<string, unknown> = {}) => ({
  state: "ready",
  walletAddress: WALLET.toLowerCase(),
  totalCount: 2,
  stale: false,
  ageMs: 60_000,
  source: "engine",
  reason: null,
  error: null,
  alerts: [
    {
      id: "a1",
      rule: "paused",
      ticker: "NVDA",
      issuer: "ondo",
      severity: "critical",
      title: "Token paused",
      body: "The issuer paused NVDAon. Buying is blocked until it resumes.",
      evidence: {
        snapshotKind: "radar",
        snapshotKey: "0xsecretkey",
        observedAt: 1_790_000_000_000,
      },
      createdAt: 1_790_000_100_000,
      createdAtFormatted: "Oct 2, 05:30 AM UTC",
    },
    {
      id: "a2",
      rule: "gradeDrop",
      ticker: "TSLA",
      issuer: "bstock",
      severity: "info",
      title: "Grade dropped to C",
      body: "TSLAB fell from B to C.",
      evidence: {
        snapshotKind: "radar",
        snapshotKey: "0xsecretkey",
        observedAt: 1_790_000_000_000,
      },
      createdAt: 1_790_000_200_000,
      createdAtFormatted: "Oct 2, 05:32 AM UTC",
    },
  ],
  ...over,
});
const settings = (telegram: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  state: "ready",
  walletAddress: WALLET.toLowerCase(),
  settings: {
    enabled: true,
    rules: {
      paused: true,
      shareCount: true,
      gradeDrop: true,
      ghost: false,
      priceThreshold: false,
      earnings: true,
    },
    quietHours: { enabled: true, startHourUtc: 22, endHourUtc: 6 },
  },
  telegram: {
    linked: false,
    chatId: null,
    alertsEnabled: false,
    activeLinkCode: null,
    ...telegram,
  },
  stale: false,
  ageMs: null,
  source: null,
  reason: null,
  error: null,
  ...over,
});

async function stub(page: Page, f: unknown, s: unknown, status = 200) {
  await page.route("**/api/session/guardian/feed", (r) => r.fulfill({ status, json: f }));
  await page.route("**/api/session/guardian/settings", (r) => r.fulfill({ status, json: s }));
}

test.describe("guardian: real server, module running", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 900 } });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3107,
      seed: "health",
      healthModules: ["guardian"],
      flags: { FEATURE_GUARDIAN: "1" },
    });
  });
  test.afterAll(() => server?.stop());

  test("signed out: asks for a sign-in, calls no session route, and the nav lists Guardian", async ({
    page,
  }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/session/")) calls.push(r.url());
    });
    await page.goto(`${server.url}/guardian`);
    await expect(page.getByTestId("guardian-signed-out")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "Guardian", exact: true }).first()).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("signed in: the session headers go to every route, no address is in a URL, and the alerts show", async ({
    page,
  }) => {
    await mockWallet(page);
    const seen: { url: string; auth: string | undefined; wallet: string | undefined }[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/session/guardian"))
        seen.push({
          url: r.url(),
          auth: r.headers()["authorization"],
          wallet: r.headers()["x-tally-wallet"],
        });
    });
    await stub(page, feed(), settings());
    await page.goto(`${server.url}/guardian`);
    await expect(page.getByTestId("guardian-alert-a1")).toContainText("Token paused", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("guardian-alert-a1")).toContainText("NVDAon");
    await expect(page.getByTestId("guardian-alert-a2")).toContainText("TSLAB");
    // Evidence names its kind and time, never the snapshot key.
    expect(await page.locator("body").innerText()).not.toContain("0xsecretkey");
    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const s of seen) {
      expect(s.auth).toBe("Bearer mock-access-token");
      expect(s.wallet?.toLowerCase()).toBe(WALLET.toLowerCase());
      expect(s.url).not.toContain(WALLET.toLowerCase());
      expect(s.url).not.toContain("address=");
    }
    // Settings are read-only and say why.
    await expect(page.getByTestId("guardian-settings")).toContainText("isn't available yet");
    await expect(page.getByTestId("guardian-settings")).toContainText(
      "Quiet hours (UTC): 22:00 to 06:00",
    );
  });

  test("not linked: a link code can be requested and is shown with its instruction", async ({
    page,
  }) => {
    await mockWallet(page);
    await stub(page, feed(), settings());
    let post: { auth?: string; wallet?: string; method: string } | null = null;
    await page.route("**/api/session/guardian/link-code", (route) => {
      const h = route.request().headers();
      post = {
        auth: h["authorization"],
        wallet: h["x-tally-wallet"],
        method: route.request().method(),
      };
      return route.fulfill({
        json: settings({
          activeLinkCode: {
            code: "AB12CD34",
            expiresAt: Date.now() + 600_000,
            expiresInSeconds: 600,
          },
        }),
      });
    });
    await page.goto(`${server.url}/guardian`);
    await expect(page.getByTestId("guardian-not-linked")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Get a link code" }).click();
    await expect(page.getByTestId("guardian-link-code")).toContainText("/link AB12CD34");
    expect(post).toMatchObject({ method: "POST", auth: "Bearer mock-access-token" });
  });

  test("linked: says so and shows no chat id", async ({ page }) => {
    await mockWallet(page);
    await stub(page, feed(), settings({ linked: true, chatId: 987654321, alertsEnabled: true }));
    await page.goto(`${server.url}/guardian`);
    await expect(page.getByTestId("guardian-linked")).toContainText("Alerts to Telegram are on", {
      timeout: 20_000,
    });
    expect(await page.locator("body").innerText()).not.toContain("987654321");
  });

  test("empty and stale feeds are told honestly; a 401 asks to sign in again", async ({ page }) => {
    await mockWallet(page);
    await stub(
      page,
      feed({
        state: "empty",
        alerts: [],
        totalCount: 0,
        reason: "No alert observations recorded yet.",
      }),
      settings(),
    );
    await page.goto(`${server.url}/guardian`);
    await expect(page.getByTestId("vm-empty-reason")).toContainText("No alert observations", {
      timeout: 20_000,
    });
    await page.unroute("**/api/session/guardian/feed");
    await page.route("**/api/session/guardian/feed", (r) =>
      r.fulfill({ json: feed({ stale: true, ageMs: 4 * 60_000 }) }),
    );
    await page.reload();
    await expect(page.getByTestId("vm-stale")).toContainText("Last update 4 min ago", {
      timeout: 20_000,
    });
    await page.unroute("**/api/session/guardian/feed");
    await page.route("**/api/session/guardian/feed", (r) =>
      r.fulfill({
        status: 401,
        json: { error: { kind: "session_required", message: "Session required" } },
      }),
    );
    await page.reload();
    await expect(page.getByTestId("guardian-unverified")).toContainText(
      "couldn't verify your sign-in",
      {
        timeout: 20_000,
      },
    );
  });

  for (const w of [375, 768, 1280] as const) {
    test(`screenshots at ${w}px with reduced motion, no horizontal scroll`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await page.goto(`${server.url}/guardian`);
      await expect(page.getByTestId("guardian-signed-out")).toBeVisible({ timeout: 20_000 });
      await page.screenshot({ path: `test-results/guardian-signedout-${w}.png`, fullPage: true });
      const ctx2 = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const p2 = await ctx2.newPage();
      await mockWallet(p2);
      await stub(p2, feed(), settings());
      await p2.goto(`${server.url}/guardian`);
      await expect(p2.getByTestId("guardian-feed")).toBeVisible({ timeout: 20_000 });
      await p2.screenshot({ path: `test-results/guardian-ready-${w}.png`, fullPage: true });
      expect(
        await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      await ctx.close();
      await ctx2.close();
    });
  }
});

test.describe("guardian: module degraded", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({ port: 3108, seed: "none", flags: { FEATURE_GUARDIAN: "1" } });
  });
  test.afterAll(() => server?.stop());

  test("shows the catching-up card and asks for nothing private", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/session/")) calls.push(r.url());
    });
    await mockWallet(page);
    await page.goto(`${server.url}/guardian`);
    await expect(page.getByRole("status", { name: "Guardian degraded" })).toContainText(
      "Guardian is catching up",
      { timeout: 20_000 },
    );
    expect(calls).toEqual([]);
  });
});

test.describe("guardian: flag off", () => {
  test("the page and the routes 404, and the nav has no Guardian link", async ({
    page,
    request,
  }) => {
    expect((await request.get("/guardian")).status()).toBe(404);
    expect((await request.get("/api/session/guardian/feed")).status()).toBe(404);
    expect((await request.get("/api/session/guardian/settings")).status()).toBe(404);
    await page.goto("/");
    await expect(page.getByRole("navigation").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Guardian", exact: true })).toHaveCount(0);
  });
});
