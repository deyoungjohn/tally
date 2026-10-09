import { expect, test, type Page } from "@playwright/test";
import { startVmServer, type VmServer } from "./vm-server";

/**
 * Radar from the flow module's view models. A real second server (flow flag on, seeded throw-away data dir) proves the route
 * and the page together; stubbed routes prove the empty and degraded states; the default server (every flag off) proves that
 * today's Radar is unchanged.
 */

const flags = (page: Page, f: Record<string, boolean>) =>
  page.route("**/api/modules/health", (route) => route.fulfill({ json: { health: [], flags: f } }));

const env = (vm: unknown, over: Record<string, unknown> = {}) => ({
  module: "flow",
  degraded: false,
  stale: false,
  ageMs: 1000,
  reason: null,
  fixtures: true,
  vm,
  ...over,
});

test.describe("radar view model: real route on a seeded server", () => {
  test.describe.configure({ mode: "serial" });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({ port: 3104, seed: "radar", flags: { FEATURE_FLOW: "1" } });
  });
  test.afterAll(() => server?.stop());

  test("the route answers grades and flow as strings, with the grade basis", async ({
    request,
  }) => {
    const res = await request.get(`${server.url}/api/vm/radar`, {
      headers: { "cf-ipcountry": "KR" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe(false);
    expect(body.fixtures).toBe(true);
    const nvda = body.vm.cards.find((c: { ticker: string }) => c.ticker === "NVDA");
    const on = nvda.grades.find((g: { symbol: string }) => g.symbol === "NVDAon");
    expect(on.gradeBasis).toBe("cleaned flow");
    expect(on.rawVolume24hUsd).toBe("250000");
    expect(nvda.grades.find((g: { symbol: string }) => g.symbol === "NVDAx").gradeBasis).toBe(
      "engine",
    );
    expect(nvda.flowPanel.issuers[0].windows[0].netShares).toBe("5.000000");
    const ghosts = await request.get(`${server.url}/api/vm/radar?ghost=1`, {
      headers: { "cf-ipcountry": "KR" },
    });
    const g = await ghosts.json();
    expect(g.vm.cards.flatMap((c: { grades: unknown[] }) => c.grades)).toHaveLength(1);
  });

  test("the Home page's Radar preview counts the same tokens as the Radar page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${server.url}/`);
    const home = page.getByTestId("home-radar");
    await expect(home).toContainText("Tokens checked", { timeout: 20_000 });
    const homeText = await home.getByTestId("radarvm-stats").innerText();
    await page.goto(`${server.url}/radar`);
    const radarText = await page.getByTestId("radarvm-stats").innerText({ timeout: 20_000 });
    expect(homeText).toBe(radarText);
  });

  test("cards load on demand: a first page, more as the end comes near, columns stay put", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route("**/api/vm/radar*", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const base = body.vm.cards[0];
      body.vm.cards = Array.from({ length: 70 }, (_, i) => ({
        ...base,
        ticker: `ZZ${String(i).padStart(2, "0")}`,
        flowPanel: null,
        grades: base.grades.map((g: { address: string; symbol: string }) => ({
          ...g,
          address: `${g.address.slice(0, 30)}${String(i).padStart(10, "0")}`,
          symbol: `ZZ${String(i).padStart(2, "0")}on`,
        })),
      }));
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(`${server.url}/radar`);
    const list = page.getByTestId("radar-masonry");
    await expect(list).toBeVisible({ timeout: 20_000 });
    await expect(list).toHaveAttribute("data-shown", "24");
    const first = await page.getByTestId("radarvm-card-ZZ00").boundingBox();
    await page.getByTestId("radar-more").getByRole("button", { name: "Show more" }).click();
    await expect(list).toHaveAttribute("data-shown", "48");
    // Scrolling to the end loads the rest by itself.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(list).toHaveAttribute("data-shown", "70", { timeout: 10_000 });
    const again = await page.getByTestId("radarvm-card-ZZ00").boundingBox();
    expect(Math.abs(first!.x - again!.x)).toBeLessThan(2);
  });

  test("large trades in a flow panel are a plain table", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route("**/api/vm/radar*", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const nvda = body.vm.cards.find((c: { ticker: string }) => c.ticker === "NVDA");
      nvda.flowPanel.issuers[0].whalePrints = [
        { txHash: "0xabc", side: "buy", shares: "60.000000", usd: "14000.00" },
        { txHash: "0xdef", side: "sell", shares: "55.000000", usd: "12800.00" },
      ];
      await route.fulfill({ response: res, json: body });
    });
    await page.goto(`${server.url}/radar`);
    await page.getByRole("radio", { name: "Flow" }).click({ timeout: 20_000 });
    const table = page.getByTestId("radarvm-whales-ondo");
    await expect(table.getByRole("table")).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(3);
    await expect(table).toContainText("$14000.00");
  });

  test("the page shows cards, the basis tooltip, the flow panel, stale and filters", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${server.url}/radar`);
    await expect(page.getByTestId("radarvm-NVDAon")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("vm-fixture-label")).toContainText("not live");
    await expect(page.getByTestId("radarvm-basis-NVDAon")).toContainText("cleaned flow");
    await expect(page.getByTestId("radarvm-cleaned-NVDAon")).toContainText("$1,633 cleaned flow");
    await expect(page.getByTestId("radarvm-NVDAx")).toContainText("Not buyable");
    await expect(page.getByTestId("radarvm-basis-NVDAx")).toContainText("raw volume");
    await page.getByTestId("radarvm-basis-NVDAon").hover();
    await expect(page.getByRole("tooltip")).toContainText("can differ on purpose");
    // Stale grade says so with its age.
    await expect(page.getByTestId("radarvm-stale-TSLAB")).toContainText(
      "Grade last updated 3 h ago",
    );
    // Filter.
    await page.getByRole("radio", { name: "Not Tradable" }).click();
    await expect(page.getByTestId("radarvm-NVDAx")).toBeVisible();
    await expect(page.getByTestId("radarvm-TSLAB")).toHaveCount(0);
    // "How we grade tokens" jumps to the explainer at the bottom.
    await page.getByRole("radio", { name: "All" }).click();
    await page.getByTestId("how-we-grade-link").click();
    await expect(page.locator("#how-we-grade")).toBeInViewport({ timeout: 5000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    // Flow tab: the busiest token is shown by default; only a click changes it, and only one is shown.
    await page.getByRole("radio", { name: "Flow" }).click();
    await expect(page.getByTestId("radarvm-flow-NVDA")).toBeVisible();
    await page.getByTestId("radarvm-flow-pick-NVDA").click();
    await expect(page.getByTestId("radarvm-flow-NVDA")).toContainText("5.000000");
    await expect(page.getByTestId("radarvm-flow-NVDA")).toContainText("Holder list unavailable");
    await expect(page.locator('[data-testid^="radarvm-flow-"][data-testid$="-TSLA"]')).toHaveCount(
      0,
    );
  });

  for (const w of [375, 768, 1280] as const) {
    test(`normal and stale at ${w}px, reduced motion, no overflow`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await page.goto(`${server.url}/radar`);
      await expect(page.getByTestId("radarvm-NVDAon")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("radio", { name: "Flow" }).click();
      await page.getByTestId("radarvm-flow-pick-NVDA").click();
      await expect(page.getByTestId("radarvm-flow-NVDA")).toBeVisible();
      await page.screenshot({ path: `test-results/radar-vm-normal-${w}.png`, fullPage: true });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }
});

test.describe("radar view model: stubbed states", () => {
  for (const w of [375, 768, 1280] as const) {
    test(`empty and degraded at ${w}px`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await flags(page, { flow: true });
      let body: unknown = env({
        state: "empty",
        reason: "Radar has no grade observations yet.",
        error: null,
        flowEnabled: true,
        source: null,
        stale: false,
        ageMs: null,
        cards: [],
      });
      await page.route("**/api/vm/radar*", (route) => route.fulfill({ json: body }));
      await page.goto("/radar");
      await expect(page.getByTestId("vm-empty-reason")).toContainText("no grade observations");
      await page.screenshot({ path: `test-results/radar-vm-empty-${w}.png`, fullPage: true });
      body = env(null, { degraded: true, reason: "Worker update is overdue", ageMs: 600_000 });
      await page.goto("/radar");
      await expect(page.getByTestId("vm-degraded")).toContainText("Radar is catching up");
      await expect(page.getByTestId("vm-degraded")).toContainText("Worker update is overdue");
      await page.screenshot({ path: `test-results/radar-vm-degraded-${w}.png`, fullPage: true });
      await ctx.close();
    });
  }

  test("flow flag off: the route 404s and Radar keeps its engine version", async ({
    page,
    request,
  }) => {
    expect((await request.get("/api/vm/radar")).status()).toBe(404);
    await page.goto("/radar");
    await expect(page.getByTestId("radar-NVDAon")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("radarvm-stats")).toHaveCount(0);
  });
});
