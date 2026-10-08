import { expect, test, type Page } from "@playwright/test";
import { startVmServer, type VmServer } from "./vm-server";

/**
 * Portfolio from the statement module's view models. Two layers:
 *  - a real second server (module flags on, seeded throw-away data dir) proves the routes and the page together;
 *  - stubbed routes on the default server prove every designed state without a store.
 * The default e2e server runs with every module flag off, which is what the flag-off tests use.
 */

const WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930"; // the recorded F11 buyer
const OTHER = "0x1111111111111111111111111111111111111111";
const EMPTY_WALLET = "0x2222222222222222222222222222222222222222";

async function mockWallet(page: Page, address = WALLET) {
  await page.addInitScript((a) => {
    (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
      address: a,
      signedIn: true,
    };
  }, address);
}

const flags = (page: Page, f: Record<string, boolean>) =>
  page.route("**/api/modules/health", (route) => route.fulfill({ json: { health: [], flags: f } }));

/* ------------------------------------------------------------- real server */

test.describe("portfolio view model: real routes on a seeded server", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 900 } });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3102,
      seed: "full",
      flags: { FEATURE_STATEMENT: "1", FEATURE_RECEIPTS: "1", FEATURE_SELL: "1" },
    });
  });
  test.afterAll(() => server?.stop());

  test("the route answers holdings in shares with the issuer breakdown", async ({ request }) => {
    const res = await request.get(`${server.url}/api/vm/portfolio?address=${WALLET}`, {
      headers: { "cf-ipcountry": "KR" },
    });
    expect(res.status()).toBe(200);
    const env = await res.json();
    expect(env.degraded).toBe(false);
    expect(env.fixtures).toBe(true);
    expect(env.vm.state).toBe("ready");
    const nvda = env.vm.holdings.find((h: { ticker: string }) => h.ticker === "NVDA");
    expect(nvda.issuers.map((i: { tokenSymbol: string }) => i.tokenSymbol).sort()).toEqual([
      "NVDAB",
      "NVDAon",
    ]);
    // Amounts are strings (bigint-safe), shares never a float.
    expect(typeof nvda.totalShares).toBe("string");
    const tsla = env.vm.holdings.find((h: { ticker: string }) => h.ticker === "TSLA");
    expect(
      tsla.issuers.find((i: { tokenSymbol: string }) => i.tokenSymbol === "TSLAon").balanceShares,
    ).toBe("unavailable");
  });

  test("a bad or missing address is refused", async ({ request }) => {
    for (const q of ["", "?address=0x123", "?address=not-an-address"]) {
      const res = await request.get(`${server.url}/api/vm/portfolio${q}`, {
        headers: { "cf-ipcountry": "KR" },
      });
      expect(res.status()).toBe(400);
    }
  });

  test("the page shows holdings from the view model, labelled as fixture data", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto(`${server.url}/portfolio`);
    const nvda = page.getByTestId("group-NVDA");
    await expect(nvda).toBeVisible({ timeout: 20_000 });
    await expect(nvda).toContainText("NVDAon");
    await expect(nvda).toContainText("NVDAB");
    await expect(page.getByTestId("vm-fixture-label")).toContainText("not live");
    await expect(page.getByTestId("total-value")).toContainText("$");
    // Unknown multiplier: shares are unknown, never a 1:1 guess, and there is no Sell for it.
    const tsla = page.getByTestId("group-TSLA");
    await expect(tsla.getByTestId("vm-issuer-TSLAon")).toContainText("unknown");
    await expect(page.getByTestId("sell-TSLAon")).toHaveCount(0);
  });

  test("Sell comes from the row actions: on for NVDAB, unclickable (with a reason) under $5", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.route("**/api/trade/sell", (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: { kind: "not_buyable", message: "No market to exit this token on BNB Chain." },
        },
      }),
    );
    await page.goto(`${server.url}/portfolio`);
    await expect(page.getByTestId("sell-NVDAB")).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByTestId("sell-TSLAB")).toBeDisabled(); // worth $2.50
    await page.getByTestId("sell-TSLAB").locator("xpath=..").hover();
    await expect(page.getByRole("tooltip")).toContainText("below the $5 minimum sale");
    await page.getByTestId("sell-NVDAB").click();
    await expect(page.getByRole("dialog", { name: "Sell NVDAB" })).toBeVisible();
  });

  test("Statement tab: lines in shares, realized only where known, CSV from the view model", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto(`${server.url}/portfolio`);
    await page.getByRole("radio", { name: "Statement" }).click({ timeout: 20_000 });
    await expect(page.getByTestId("st-table")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("st-table")).toContainText("Sale");
    await expect(page.getByTestId("st-converted")).toContainText("converted at today's ratio");
    await expect(page.getByTestId("st-realized")).toContainText("$");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("st-csv").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^tally-statement-0x2bf7ed-\d{4}-\d{2}-\d{2}\.csv$/,
    );
  });

  test("Activity tab lists the wallet's receipts with their status and a BscScan link", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto(`${server.url}/portfolio`);
    await page.getByRole("radio", { name: "Activity" }).click({ timeout: 20_000 });
    await expect(page.getByTestId("vm-activity")).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId("vm-activity").getByTestId("activity-status").first(),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("vm-activity")
        .getByRole("link", { name: /BscScan/ })
        .first(),
    ).toHaveAttribute("href", /bscscan\.com\/tx\/0x/);
  });

  test("the Other assets panel reads the two balances from the engine route and labels them as recorded", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto(`${server.url}/portfolio`);
    await expect(page.getByTestId("group-NVDA")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("wallet-balances")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("balances-fixture-label")).toContainText("not live");
  });

  test("a snapshot older than the freshness window says it is stale, with its age", async ({
    page,
  }) => {
    await page.goto(`${server.url}/portfolio?address=${OTHER}`);
    await expect(page.getByTestId("vm-stale")).toContainText("Last update 20 min ago", {
      timeout: 20_000,
    });
  });

  test("a wallet with no snapshot is empty with the reason, not claimed as an empty wallet", async ({
    page,
  }) => {
    await page.goto(`${server.url}/portfolio?address=${EMPTY_WALLET}`);
    await expect(page.getByTestId("vm-empty-reason")).toContainText("No holdings", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("vm-empty-help")).toContainText(
      "No portfolio snapshot has been collected",
    );
  });
});

test.describe("portfolio view model: module degraded", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let server: VmServer;
  test.beforeAll(async () => {
    // Flags on, but no module has ever reported a successful update.
    server = await startVmServer({
      port: 3103,
      seed: "none",
      flags: { FEATURE_STATEMENT: "1", FEATURE_RECEIPTS: "1" },
    });
  });
  test.afterAll(() => server?.stop());

  test("the route claims nothing and the page shows the catching-up card", async ({
    page,
    request,
  }) => {
    const res = await request.get(`${server.url}/api/vm/portfolio?address=${WALLET}`, {
      headers: { "cf-ipcountry": "KR" },
    });
    const env = await res.json();
    expect(env.degraded).toBe(true);
    expect(env.vm).toBeNull();
    await page.goto(`${server.url}/portfolio?address=${WALLET}`);
    await expect(page.getByTestId("vm-degraded")).toContainText("Portfolio is catching up", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("vm-degraded")).toContainText("No successful update yet");
  });
});

test.describe("portfolio view model: flag off", () => {
  test("the routes 404 and the page keeps its engine-based version", async ({ page, request }) => {
    for (const name of ["portfolio", "statement", "activity"]) {
      const res = await request.get(`/api/vm/${name}?address=${WALLET}`);
      expect(res.status()).toBe(404);
    }
    const hit: string[] = [];
    page.on("request", (r) => hit.push(new URL(r.url()).pathname));
    await mockWallet(page);
    // (The signed-out page also shows an example group, so wait for the real request instead of a group.)
    const legacy = page.waitForRequest(/\/api\/portfolio\?address=/);
    await page.goto("/portfolio");
    await legacy;
    expect(hit).toContain("/api/portfolio");
    expect(hit).not.toContain("/api/vm/portfolio");
    await expect(page.getByTestId("portfolio-vm")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------ stubbed states */

const holdingVm = (over: Record<string, unknown> = {}) => ({
  state: "ready",
  walletAddress: WALLET,
  totalValueUsd: "123.16",
  totalRealizedPnlUsd: "0.03",
  totalUnrealizedPnlUsd: "2.15",
  holdings: [
    {
      ticker: "NVDA",
      totalShares: "0.5266",
      totalValueUsd: "123.16",
      avgCostPerShareUsd: "229.60",
      unrealizedPnlUsd: "2.15",
      unrealizedPnlPercent: "1.87",
      rowActionsSlot: {
        token: "0xa9",
        issuer: "ondo",
        balanceTokens: "0.5",
        balanceShares: "0.5266",
        ticker: "NVDA",
      },
      issuers: [
        {
          issuer: "ondo",
          tokenSymbol: "NVDAon",
          tokenContractAddress: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
          balanceTokens: "0.5",
          multiplier: "1.0017",
          balanceShares: "0.5009",
          convertedAtTodaysRatio: false,
          valueUsd: "117.15",
          pricePerShareUsd: "233.90",
          rowActionsSlot: {
            token: "0xa9",
            issuer: "ondo",
            balanceTokens: "0.5",
            balanceShares: "0.5009",
            ticker: "NVDA",
          },
        },
        {
          issuer: "bstock",
          tokenSymbol: "NVDAB",
          tokenContractAddress: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
          balanceTokens: "0.0257",
          multiplier: "1.000778",
          balanceShares: "0.0257",
          convertedAtTodaysRatio: false,
          valueUsd: "6.01",
          pricePerShareUsd: "233.90",
          rowActionsSlot: {
            token: "0x02",
            issuer: "bstock",
            balanceTokens: "0.0257",
            balanceShares: "0.0257",
            ticker: "NVDA",
          },
        },
      ],
    },
  ],
  availableTabs: ["holdings", "activity", "statement"],
  activeTab: "holdings",
  stale: false,
  ageMs: 60_000,
  source: "api/portfolio/recent-pnl",
  error: null,
  ...over,
});

const env = (vm: unknown, over: Record<string, unknown> = {}) => ({
  module: "statement",
  degraded: false,
  stale: false,
  ageMs: 60_000,
  reason: null,
  fixtures: false,
  vm,
  ...over,
});

async function stubPortfolio(page: Page, body: unknown, delayMs = 0) {
  await flags(page, { statement: true, receipts: true, sell: true });
  // The chain read behind "Also in your wallet": none by default, so these tests see only the view model.
  await page.route("**/api/portfolio?*", (route) =>
    route.fulfill({
      json: {
        address: WALLET,
        asOf: new Date().toISOString(),
        groups: [],
        totalValueUsd: 0,
        wallet: { usdt: 0, bnb: 0 },
        failed: [],
      },
    }),
  );
  await page.route("**/api/vm/portfolio*", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: body });
  });
}

test.describe("portfolio view model: states (stubbed routes)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("normal: token name first (bold, bigger), then the issuer (faint, thinner); shares as strings", async ({
    page,
  }) => {
    await mockWallet(page);
    await stubPortfolio(page, env(holdingVm()));
    await page.goto("/portfolio");
    await expect(page.getByTestId("vm-total-shares-NVDA")).toHaveText("0.5266", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("total-value")).toHaveText("$123.16");
    const look = (id: string) =>
      page.getByTestId(id).evaluate((e) => {
        const cs = getComputedStyle(e);
        return { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
      });
    const sym = await look("holding-symbol-NVDAB");
    const iss = await look("holding-issuer-NVDAB");
    expect(sym.size).toBeGreaterThan(iss.size);
    expect(sym.weight).toBeGreaterThan(iss.weight);
    await expect(page.getByTestId("vm-fixture-label")).toHaveCount(0); // not fixture data: nothing is labelled as such
  });

  test("loading shows a skeleton first", async ({ page }) => {
    await mockWallet(page);
    await stubPortfolio(page, env(holdingVm()), 1200);
    await page.goto("/portfolio");
    await expect(page.getByTestId("vm-loading")).toBeVisible();
    await expect(page.getByTestId("group-NVDA")).toBeVisible({ timeout: 20_000 });
  });

  test("empty shows the view model's reason", async ({ page }) => {
    await mockWallet(page);
    await stubPortfolio(
      page,
      env(
        holdingVm({
          state: "empty",
          holdings: [],
          reason: "No holdings in this wallet.",
          source: "api",
        }),
      ),
    );
    await page.goto("/portfolio");
    await expect(page.getByTestId("vm-empty-reason")).toHaveText("No holdings in this wallet.", {
      timeout: 20_000,
    });
  });

  test("stale shows how old the last update is", async ({ page }) => {
    await mockWallet(page);
    await stubPortfolio(
      page,
      env(holdingVm({ stale: true, ageMs: 4 * 60_000 }), { stale: true, ageMs: 4 * 60_000 }),
    );
    await page.goto("/portfolio");
    await expect(page.getByTestId("vm-stale")).toContainText("Last update 4 min ago", {
      timeout: 20_000,
    });
  });

  test("degraded: no data, a plain card", async ({ page }) => {
    await mockWallet(page);
    await stubPortfolio(
      page,
      env(null, { degraded: true, reason: "Worker update is overdue", ageMs: 600_000 }),
    );
    await page.goto("/portfolio");
    await expect(page.getByTestId("vm-degraded")).toContainText("Worker update is overdue", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("vm-degraded")).toContainText("10 min ago");
    await expect(page.getByTestId("group-NVDA")).toHaveCount(0);
  });

  test("an unknown multiplier reads unknown, with no Sell", async ({ page }) => {
    await mockWallet(page);
    const vm = holdingVm();
    (vm.holdings[0]!.issuers[0] as Record<string, unknown>).multiplier = "unavailable";
    (vm.holdings[0]!.issuers[0] as Record<string, unknown>).balanceShares = "unavailable";
    await stubPortfolio(page, env(vm));
    await page.goto("/portfolio");
    await expect(page.getByTestId("vm-issuer-NVDAon")).toContainText("unknown", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("sell-NVDAon")).toHaveCount(0);
    await expect(page.getByTestId("sell-NVDAB")).toBeEnabled();
  });

  test("the sell flag off hides every Sell button", async ({ page }) => {
    await mockWallet(page);
    await stubPortfolio(page, env(holdingVm()));
    await flags(page, { statement: true, receipts: true, sell: false });
    await page.goto("/portfolio");
    await expect(page.getByTestId("group-NVDA")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Sell / })).toHaveCount(0);
  });

  test("a tab that is not offered is not shown", async ({ page }) => {
    await mockWallet(page);
    await stubPortfolio(page, env(holdingVm({ availableTabs: ["holdings"] })));
    await page.goto("/portfolio");
    await expect(page.getByTestId("group-NVDA")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("radiogroup", { name: "Portfolio section" })).toHaveCount(0);
  });

  test("looking at someone else's wallet shows no Sell buttons", async ({ page }) => {
    await mockWallet(page);
    await stubPortfolio(page, env(holdingVm()));
    await page.goto(`/portfolio?address=${OTHER}`);
    await expect(page.getByTestId("group-NVDA")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Sell / })).toHaveCount(0);
  });

  for (const w of [375, 768, 1280] as const) {
    test(`fits at ${w}px with reduced motion, no horizontal scroll`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await mockWallet(page);
      await stubPortfolio(page, env(holdingVm()));
      await page.route("**/api/vm/statement*", (route) =>
        route.fulfill({
          json: env({
            state: "ready",
            walletAddress: WALLET,
            asOf: "2026-10-06T10:00:00.000Z",
            lines: [
              {
                date: "2026-10-05T10:00:00.000Z",
                ticker: "NVDA",
                issuer: "ondo",
                type: "BUY",
                amountTokens: "0.5",
                multiplier: "1.0017",
                amountShares: "0.5009",
                pricePerShareUsd: "229.60",
                valueUsd: "115.00",
                convertedAtTodaysRatio: false,
                txHash: `0x${"a1".repeat(32)}`,
              },
            ],
            totalValueUsd: "117.15",
            totalCostBasisUsd: "115.00",
            totalRealizedPnlUsd: "0.00",
            totalUnrealizedPnlUsd: "2.15",
            differsFromApi: false,
            convertedAtTodaysRatio: false,
            notes: ["Example note"],
            csv: { filename: "s.csv", content: "a,b\n1,2" },
            stale: false,
            ageMs: 1000,
            source: "api",
            error: null,
          }),
        }),
      );
      await page.goto("/portfolio");
      await expect(page.getByTestId("group-NVDA")).toBeVisible({ timeout: 20_000 });
      await page.screenshot({
        path: `test-results/portfolio-vm-holdings-${w}.png`,
        fullPage: true,
      });
      await page.getByRole("radio", { name: "Statement" }).click();
      await expect(page.getByTestId("st-table")).toBeVisible();
      await page.screenshot({
        path: `test-results/portfolio-vm-statement-${w}.png`,
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }

  for (const w of [375, 768, 1280] as const) {
    test(`state screenshots at ${w}px (normal, empty, stale, degraded), reduced motion`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await mockWallet(page);
      await flags(page, { statement: true, receipts: true, sell: true });
      let body: unknown = env(holdingVm());
      await page.route("**/api/portfolio?*", (route) =>
        route.fulfill({
          json: {
            address: WALLET,
            asOf: new Date().toISOString(),
            groups: [],
            totalValueUsd: 0,
            wallet: { usdt: 0, bnb: 0 },
            failed: [],
          },
        }),
      );
      await page.route("**/api/vm/portfolio*", (route) => route.fulfill({ json: body }));
      const states: [string, unknown, string][] = [
        ["normal", env(holdingVm()), "vm-holdings"],
        [
          "empty",
          env(
            holdingVm({
              state: "empty",
              holdings: [],
              reason: "No holdings in this wallet.",
              source: null,
            }),
          ),
          "vm-empty",
        ],
        [
          "stale",
          env(holdingVm({ stale: true, ageMs: 4 * 60_000 }), { stale: true, ageMs: 4 * 60_000 }),
          "vm-stale",
        ],
        [
          "degraded",
          env(null, { degraded: true, reason: "Worker update is overdue" }),
          "vm-degraded",
        ],
      ];
      for (const [name, b, marker] of states) {
        body = b;
        await page.goto("/portfolio");
        await expect(page.getByTestId(marker)).toBeVisible({ timeout: 20_000 });
        await page.screenshot({
          path: `test-results/portfolio-vm-${name}-${w}.png`,
          fullPage: true,
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      }
      await ctx.close();
    });
  }
});

/* ---------------------------------------------------------- other assets panel */

test.describe("other assets: wallet.usdt and wallet.bnb only, from /api/portfolio", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  const report = (over: Record<string, unknown> = {}) => ({
    address: WALLET,
    asOf: new Date().toISOString(),
    // Float-based holdings the view model replaces: they must never reach the screen in this mode.
    groups: [
      {
        ticker: "NVDA",
        shares: 99.123456,
        valueUsd: 98765.43,
        referencePrice: 1,
        parts: [],
      },
    ],
    totalValueUsd: 98765.43,
    wallet: { usdt: 12.5, bnb: 0.00123 },
    failed: [],
    ...over,
  });
  const run = async (
    page: Page,
    portfolio: { status?: number; body?: unknown },
    fixtures = false,
  ) => {
    await mockWallet(page);
    await stubPortfolio(page, env(holdingVm(), { fixtures }));
    await page.route("**/api/portfolio?*", (route) =>
      route.fulfill({ status: portfolio.status ?? 200, json: portfolio.body ?? report() }),
    );
    await page.goto("/portfolio");
    await expect(page.getByTestId("group-NVDA")).toBeVisible({ timeout: 20_000 });
  };

  test("shows the two balances as plain wallet balances, never the engine route's float holdings", async ({
    page,
  }) => {
    await run(page, {});
    await expect(page.getByTestId("balance-usdt")).toContainText("$12.50", { timeout: 20_000 });
    await expect(page.getByTestId("balance-bnb")).toContainText("0.00123");
    await expect(page.getByTestId("balances-fixture-label")).toHaveCount(0);
    const text = await page.getByTestId("portfolio-vm").innerText();
    expect(text).not.toContain("99.12");
    expect(text).not.toContain("98,765");
    // The total comes from the view model, not from the engine route.
    await expect(page.getByTestId("total-value")).toHaveText("$123.16");
  });

  test("a token held on chain but missing from the statement feed is still shown, labelled", async ({
    page,
  }) => {
    await run(page, {
      body: report({
        groups: [
          {
            ticker: "TSM",
            shares: 1.5,
            valueUsd: 300,
            referencePrice: 200,
            parts: [
              {
                ticker: "TSM",
                symbol: "TSMon",
                issuer: "ondo",
                address: "0x00000000000000000000000000000000000ee011",
                tokens: 1.5,
                multiplier: 1,
                shares: 1.5,
                valueUsd: 300,
                grade: "A",
              },
            ],
          },
        ],
      }),
    });
    const extra = page.getByTestId("chain-only-holdings");
    await expect(extra).toBeVisible({ timeout: 20_000 });
    await expect(extra).toContainText("TSMon");
    await expect(extra).toContainText("TSMC");
    await expect(page.getByTestId("group-NVDA")).toBeVisible();
  });

  test("a fixture server says the balances are recorded, not live", async ({ page }) => {
    await run(page, {}, true);
    await expect(page.getByTestId("balances-fixture-label")).toContainText("not live", {
      timeout: 20_000,
    });
  });

  test("a failed read hides the panel instead of showing zeros", async ({ page }) => {
    await run(page, { status: 500, body: { error: { kind: "internal", message: "x" } } });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("wallet-balances")).toHaveCount(0);
    await expect(page.getByText("$0.00")).toHaveCount(0);
  });

  test("a stale read (older than two minutes) is hidden", async ({ page }) => {
    await run(page, { body: report({ asOf: new Date(Date.now() - 10 * 60_000).toISOString() }) });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("wallet-balances")).toHaveCount(0);
  });

  test("the real fixture server: panel present and labelled as recorded", async ({ page }) => {
    // Uses the default (flags-off) server only to prove the engine route's shape still carries wallet.usdt and wallet.bnb.
    const res = await page.request.get(`/api/portfolio?address=${WALLET}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.wallet.usdt).toBe("number");
    expect(typeof body.wallet.bnb).toBe("number");
    expect(typeof body.asOf).toBe("string");
  });
});

/* ------------------------------------------- wallet registration for the worker */

test.describe("active wallet registration (verified route, called after sign-in)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  type Seen = { auth: string | null; wallet: string | null; body: string | null };
  const watch = async (page: Page, status = 204) => {
    const seen: Seen[] = [];
    await page.route("**/api/session/active-wallet", async (route) => {
      const h = route.request().headers();
      seen.push({
        auth: h["authorization"] ?? null,
        wallet: h["x-tally-wallet"] ?? null,
        body: route.request().postData(),
      });
      await route.fulfill({ status, body: "" });
    });
    return seen;
  };

  test("statement on and signed in: one POST with the bearer token and the wallet header, nothing in the body", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { statement: true });
    const seen = await watch(page);
    const logs: string[] = [];
    page.on("console", (m) => logs.push(m.text()));
    await page.goto("/");
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toEqual({ auth: "Bearer mock-access-token", wallet: WALLET, body: null });
    // Wait until the page has recorded the registration (it does so once the response arrives), then check that another page
    // in the same tab session does not post again.
    await page.waitForFunction(() =>
      Object.keys(sessionStorage).some((k) => k.startsWith("tally.activeWallet.")),
    );
    await page.goto("/portfolio");
    await page.waitForTimeout(800);
    expect(seen).toHaveLength(1);
    expect(logs.join("\n")).not.toContain("mock-access-token");
  });

  test("statement off: nothing is sent", async ({ page }) => {
    await mockWallet(page);
    await flags(page, { statement: false });
    const seen = await watch(page);
    await page.goto("/");
    await page.waitForTimeout(1200);
    expect(seen).toHaveLength(0);
  });

  test("signed out: nothing is sent", async ({ page }) => {
    await page.addInitScript((a) => {
      (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
        address: a,
        signedIn: false,
      };
    }, WALLET);
    await flags(page, { statement: true });
    const seen = await watch(page);
    await page.goto("/");
    await page.waitForTimeout(1200);
    expect(seen).toHaveLength(0);
  });

  test("a route that is not deployed yet (404) is silent and the page works; it tries again on the next load", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { statement: true });
    const seen = await watch(page, 404);
    await page.goto("/");
    await expect.poll(() => seen.length).toBe(1);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/portfolio");
    await expect.poll(() => seen.length).toBe(2);
  });
});
