import { expect, test, type Page } from "@playwright/test";
import { startVmServer, type VmServer } from "./vm-server";

// The /pies page (flag `pies`): basket cards, budget and weights, the review sheet and the sequential run, on the mock wallet.
const USER = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"b2".padStart(64, "0")}`;
const GUARD = "0x28F6F19bffbF25E36452c78d12090F0bC922970a";
const STOCK = "0x3333333333333333333333333333333333333333";

async function wallet(page: Page, signedIn = true) {
  await page.addInitScript(
    ([address, s]) => {
      window.__tallyMockWallet = { address: address as `0x${string}`, signedIn: s as boolean };
    },
    [USER, signedIn] as const,
  );
}

async function stubTrade(page: Page, controls: { failTicker?: string } = {}) {
  await page.route("**/api/trade/plan", async (route) => {
    const request = route.request().postDataJSON() as { ticker: string };
    if (controls.failTicker && request.ticker === controls.failTicker) {
      await route.fulfill({
        status: 409,
        json: { error: { kind: "route_failed", message: "No route for this stock right now" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        status: "ready",
        ticker: request.ticker,
        issuer: "bstock",
        symbol: `${request.ticker}B`,
        stock: STOCK,
        guard: GUARD,
        builtAt: Date.now(),
        expiresAt: Date.now() + 15000,
        amountInUsdt: "6000000000000000000",
        tolerancePct: 1,
        tokensOut: "1",
        quotedShares: "1",
        minShares: "1",
        multiplier: "1000000000000000000",
        usdPerShare: 6,
        referencePrice: 6,
        premium: 0,
        routeText: "Constructed browser fixture",
        vendor: "fixture",
        hops: 1,
        feedUpdate: false,
        warnings: [],
        balances: { usdt: "30000000000000000000", bnb: "1000000000000000" },
        tx: {
          to: GUARD,
          data: "0x1234",
          value: "0x0",
          chainId: 56,
          gasEstimate: "400000",
          gasLimit: "500000",
          gasPriceWei: "1",
          feeUsd: 0.01,
          deadline: Math.floor(Date.now() / 1000) + 300,
        },
      },
    });
  });
  const ok = (route: import("@playwright/test").Route) =>
    route.fulfill({
      json: {
        status: "success",
        txHash: HASH,
        hash: HASH,
        bscscan: `https://bscscan.com/tx/${HASH}`,
      },
    });
  await page.route("**/api/trade/receipt?**", ok);
  await page.route("**/api/trade/tx-status?**", ok);
}

const THREE = { NVDA: "33.33", AAPL: "33.33", GOOGL: "33.34", MSFT: "0", META: "0" };
async function setWeights(page: Page, weights: Record<string, string>) {
  for (const [ticker, value] of Object.entries(weights))
    await page.getByRole("textbox", { name: `Weight ${ticker}B %` }).fill(value);
}
const sent = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __tallySentTxs?: unknown[] }).__tallySentTxs?.length ?? 0,
  );

test.describe("pies page: flag off", () => {
  test("404 with the pies flag off", async ({ request }) => {
    expect((await request.get("/pies")).status()).toBe(404);
  });
});

test.describe("pies page", () => {
  test.describe.configure({ mode: "serial" });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3141,
      seed: "health",
      healthModules: ["pies"],
      flags: { FEATURE_PIES: "1" },
    });
  });
  test.afterAll(() => server?.stop());

  test("the basket card, chips, fixture label, roadmap and equal weights", async ({ page }) => {
    await wallet(page, false);
    await page.goto(`${server.url}/pies`);
    await expect(page.getByTestId("pies-screen")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("basket-big-tech")).toContainText("Big Tech");
    for (const s of ["NVDAB", "AAPLB", "GOOGLB", "MSFTB", "METAB"])
      await expect(page.getByTestId(`chip-${s}`)).toBeVisible();
    await expect(page.getByTestId("basket-big-tech")).toContainText("Minimum budget $30");
    await expect(page.getByTestId("vm-fixture-label")).toContainText("not live");
    await expect(page.getByTestId("pies-roadmap")).toContainText(
      "Atomic baskets, auto-rebalancing and selling a basket: coming soon",
    );
    await expect(page.getByTestId("pies-total")).toContainText("Total 100%");
    // Signed out: Sign in instead of Start.
    await expect(page.getByTestId("pies-signin")).toBeVisible();
    await expect(page.getByTestId("pies-start")).toHaveCount(0);
  });

  test("a $30 budget at equal weights is five $6 legs; legs under $6 are deferred with the reason", async ({
    page,
  }) => {
    await wallet(page);
    await page.goto(`${server.url}/pies`);
    await expect(page.getByTestId("pies-preview")).toBeVisible({ timeout: 20_000 });
    for (const t of ["NVDA", "AAPL", "GOOGL", "MSFT", "META"])
      await expect(page.getByTestId(`preview-${t}`)).toContainText("$6.00");
    await expect(page.getByTestId("pies-total-usdt")).toHaveText("$30.00");
    await expect(page.getByTestId("pies-unspent")).toHaveText("$0.00");
    await page.getByTestId("pies-budget").fill("20");
    await expect(page.getByTestId("preview-NVDA")).toContainText("Deferred");
    await expect(page.getByTestId("preview-NVDA")).toContainText("below the 6.00 USDT minimum");
    await expect(page.getByTestId("pies-total-usdt")).toHaveText("$0.00");
    await expect(page.getByTestId("pies-start")).toBeDisabled();
    await expect(page.getByTestId("pies-blocker")).toBeVisible();
  });

  test("weights must total 100%: shown, Start disabled, 'Make it 100%' fixes it, Equal resets", async ({
    page,
  }) => {
    await wallet(page);
    await page.goto(`${server.url}/pies`);
    await expect(page.getByTestId("pies-total")).toContainText("Total 100%", { timeout: 20_000 });
    await page.getByRole("textbox", { name: "Weight NVDAB %" }).fill("40");
    await expect(page.getByTestId("pies-total")).toContainText("Total 120%: must be 100%");
    await expect(page.getByTestId("pies-start")).toBeDisabled();
    await expect(page.getByTestId("pies-blocker")).toContainText("must total 100%");
    await page.getByTestId("pies-normalise").click();
    await expect(page.getByTestId("pies-total")).toContainText("Total 100%");
    await expect(page.getByTestId("pies-total")).not.toContainText("must be");
    await page.getByRole("textbox", { name: "Weight AAPLB %" }).fill("abc");
    await expect(page.getByTestId("pies-start")).toBeDisabled();
    await page.getByTestId("pies-equal").click();
    await expect(page.getByRole("textbox", { name: "Weight AAPLB %" })).toHaveValue("20");
    await expect(page.getByTestId("pies-total")).toContainText("Total 100%");
  });

  test("review, then three legs run one after another with a receipt each and a summary", async ({
    page,
  }) => {
    await wallet(page);
    await stubTrade(page);
    await page.goto(`${server.url}/pies`);
    await expect(page.getByTestId("pies-builder")).toBeVisible({ timeout: 20_000 });
    await setWeights(page, THREE);
    await page.getByTestId("pies-budget").fill("18.01");
    await page.getByTestId("pies-start").click();
    const review = page.getByTestId("pies-review");
    await expect(review).toContainText(
      "Each stock is bought through the guarantee, one after another",
    );
    await expect(review).toContainText("NVDAB");
    await page.getByTestId("pies-confirm").click();
    await expect(page.getByTestId("pie-status")).toHaveText("done", { timeout: 30_000 });
    for (const t of ["NVDA", "AAPL", "GOOGL"]) {
      await expect(page.getByTestId(`pie-leg-${t}`)).toContainText("Done");
      await expect(page.getByTestId(`pie-leg-${t}`).getByRole("link")).toHaveAttribute(
        "href",
        `https://bscscan.com/tx/${HASH}`,
      );
    }
    await expect(page.getByTestId("pies-summary")).toContainText("3 stocks bought for $18.00");
    expect(await sent(page)).toBe(3);
    await page.getByTestId("pies-dismiss").click();
    await expect(page.getByTestId("pies-builder")).toBeVisible();
  });

  test("a failed leg stops the run with the plain reason; Continue finishes the rest", async ({
    page,
  }) => {
    await wallet(page);
    const controls: { failTicker?: string } = { failTicker: "AAPL" };
    await stubTrade(page, controls);
    await page.goto(`${server.url}/pies`);
    await expect(page.getByTestId("pies-builder")).toBeVisible({ timeout: 20_000 });
    await setWeights(page, THREE);
    await page.getByTestId("pies-budget").fill("18.01");
    await page.getByTestId("pies-start").click();
    await page.getByTestId("pies-confirm").click();
    await expect(page.getByTestId("pie-leg-NVDA")).toContainText("Done", { timeout: 30_000 });
    await expect(page.getByTestId("pie-leg-AAPL")).toContainText("Failed");
    await expect(page.getByTestId("pie-leg-AAPL")).toContainText(
      "No route for this stock right now",
    );
    await expect(page.getByTestId("pie-leg-GOOGL")).toContainText("Not started");
    await expect(page.getByTestId("pies-stopped")).toContainText("1 bought");
    expect(await sent(page)).toBe(1);
    controls.failTicker = undefined;
    await page.getByTestId("pies-continue").click();
    await expect(page.getByTestId("pie-status")).toHaveText("done", { timeout: 30_000 });
    expect(await sent(page)).toBe(3);
  });

  test("a reload mid-run resumes from the saved run and never signs a saved leg twice", async ({
    page,
  }) => {
    await wallet(page);
    await stubTrade(page, { failTicker: "AAPL" });
    await page.goto(`${server.url}/pies`);
    await expect(page.getByTestId("pies-builder")).toBeVisible({ timeout: 20_000 });
    await setWeights(page, THREE);
    await page.getByTestId("pies-budget").fill("18.01");
    await page.getByTestId("pies-start").click();
    await page.getByTestId("pies-confirm").click();
    await expect(page.getByTestId("pie-leg-AAPL")).toContainText("Failed", { timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId("pie-leg-NVDA")).toContainText("Done", { timeout: 20_000 });
    await expect(page.getByTestId("pie-leg-AAPL")).toContainText("Failed");
    expect(await sent(page)).toBe(0);
  });

  for (const w of [375, 768, 1280] as const) {
    test(`at ${w}px with reduced motion: builder, review and progress fit the screen`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await wallet(page);
      await stubTrade(page);
      const noScroll = async () =>
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBeLessThanOrEqual(0);
      await page.goto(`${server.url}/pies`);
      await expect(page.getByTestId("pies-builder")).toBeVisible({ timeout: 20_000 });
      await noScroll();
      await page.screenshot({ path: `test-results/pies-builder-${w}.png`, fullPage: true });
      await page.getByTestId("pies-start").click();
      await expect(page.getByTestId("pies-review")).toBeVisible();
      await page.screenshot({ path: `test-results/pies-review-${w}.png` });
      await page.getByTestId("pies-confirm").click();
      await expect(page.getByTestId("pie-status")).toHaveText("done", { timeout: 30_000 });
      await noScroll();
      await page.screenshot({ path: `test-results/pies-done-${w}.png`, fullPage: true });
      await ctx.close();
    });
  }
});

test.describe("pies page: module never updated", () => {
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({ port: 3142, seed: "none", flags: { FEATURE_PIES: "1" } });
  });
  test.afterAll(() => server?.stop());
  test("shows the catching-up card and offers nothing to buy", async ({ page }) => {
    await wallet(page);
    await page.goto(`${server.url}/pies`);
    await expect(page.getByTestId("vm-degraded")).toContainText("Pies is catching up", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("pies-start")).toHaveCount(0);
  });
});
