/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from "@playwright/test";

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";
const STOCK = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"; // NVDAB
const ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5";
const RAW_BALANCE = "25654736000000000";
const HASH = `0x${"b2".padStart(64, "0")}`;

async function mockWallet(page: Page) {
  await page.addInitScript(
    ([address]) => {
      (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
        address,
        signedIn: true,
        reject: false,
      };
    },
    [USER] as const,
  );
}

const flags = (page: Page, switchFlag: boolean) =>
  page.route("**/api/modules/health", (route) =>
    route.fulfill({
      json: { health: [], flags: { switch: switchFlag, receipts: true, sell: true } },
    }),
  );

async function stubReceipts(page: Page, status = 200, state = "reconciled") {
  await page.route("**/api/receipts*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status,
        json: {
          state,
          hash: HASH,
          usdtReceived: "6.99",
          usdtReceivedRaw: "6990000000000000000",
          tokensSpent: "2500",
        },
      });
    } else {
      await route.fulfill({ status: 200, json: { ok: true } });
    }
  });
}

function plan(status: "ready" | "needs_approval" | "needs_funds" = "ready") {
  return {
    status,
    builtAt: Date.now(),
    expiresAt: Date.now() + 15_000,
    ticker: "NVDA",
    issuer: "bstock",
    symbol: "NVDAB",
    stock: STOCK,
    user: USER,
    tolerancePct: 1,
    tokensIn: "10000000000000000",
    sharesIn: "10007780000000000",
    quotedUsdtOut: "7000000000000000000",
    minUsdtOut: "6990000000000000000",
    floorSource: "router",
    multiplier: "1000778000000000000",
    usdPerShare: 233.8,
    referencePrice: 233.9,
    routeText: "NVDAB → USDT",
    hops: 1,
    vendor: "LiquidMesh",
    balances: { tokens: RAW_BALANCE, bnb: "50000000000000000" },
    warnings: [],
    shortfall: status === "needs_funds" ? { bnb: "10", bnbNeeded: "20" } : undefined,
    tx:
      status === "ready"
        ? {
            to: ROUTER,
            data: "0x123",
            value: "0x0",
            chainId: 56,
            gasLimit: "375000",
            gasEstimate: "300000",
          }
        : undefined,
    fee: { limit: "150000", usd: 0.1 },
    approveTarget: ROUTER,
  };
}

async function stubSell(page: Page, p = plan()) {
  await page.route("**/api/trade/sell", async (route) => {
    await route.fulfill({ status: 200, json: p });
  });
}

async function stubStatus(page: Page) {
  await page.route("**/api/trade/tx-status*", async (route) => {
    await route.fulfill({
      status: 200,
      json: { status: "success", blockNumber: 123, gasUsed: 10000, bscscan: "url" },
    });
  });
}

async function stubBuy(page: Page) {
  await page.route("**/api/trade/plan", async (route) => {
    const p = {
      status: "ready",
      builtAt: Date.now(),
      expiresAt: Date.now() + 10000,
      ticker: "NVDA",
      issuer: "ondo",
      symbol: "NVDAon",
      stock: STOCK,
      guard: "0xguard",
      tolerancePct: 1,
      amountInUsdt: "6990000000000000000",
      tokensOut: "20000000000000000",
      quotedShares: "20000000000000000",
      minShares: "19900000000000000",
      multiplier: "1000000000000000000",
      usdPerShare: 350.0,
      referencePrice: 350.0,
      premium: 0,
      routeText: "USDT → NVDAon",
      hops: 1,
      vendor: "LiquidMesh",
      feedUpdate: true,
      warnings: [],
      balances: { usdt: "10000000000000000000", bnb: "10000000000000000000" },
      tx: {
        to: ROUTER,
        data: "0x",
        value: "0x0",
        gasEstimate: "300000",
        gasLimit: "375000",
        gasPriceWei: "1000000000",
        feeUsd: 0.1,
        deadline: Date.now() + 10000,
        chainId: 56,
      },
    };
    await route.fulfill({ json: p });
  });
}

test.describe("Migrate", () => {
  [
    { w: 375, h: 667, motion: "reduce" },
    { w: 768, h: 1024, motion: "no-preference" },
    { w: 1280, h: 800, motion: "no-preference" },
  ].forEach(({ w, h, motion }) => {
    test.use({
      viewport: { width: w, height: h },
      colorScheme: "light",
      reducedMotion: motion as any,
    });
    test(`full two-step migration at ${w}x${h} (${motion})`, async ({ page }) => {
      await flags(page, true);
      await mockWallet(page);
      await stubSell(page, plan("ready"));
      await stubStatus(page);
      await stubReceipts(page);
      await stubBuy(page);

      await page.goto("/portfolio");

      // Click Migrate button for NVDAB
      const migrateBtn = page.getByTestId("migrate-NVDAB");
      await expect(migrateBtn).toBeVisible({ timeout: 20_000 });
      await migrateBtn.click();

      // Check sell sheet title
      await expect(page.getByRole("dialog").filter({ hasText: "Sell NVDAB" })).toBeVisible();

      // Check and click through step 1 (Sell)
      await page.getByTestId("sell-all").click();
      await page.getByTestId("sell-confirm").click();
      // In mock wallet it auto-signs tx, then we wait for status
      // Then it moves to interstitial
      await expect(
        page.getByRole("dialog").filter({ hasText: "Sold NVDAB for 6.99 USDT" }),
      ).toBeVisible();

      // Resume step 2
      await page.getByRole("button", { name: "Buy now" }).click();

      // Check buy sheet title
      await expect(page.getByRole("dialog").filter({ hasText: "Review your buy" })).toBeVisible();

      // Confirm buy
      await page.getByTestId("confirm-buy").click();

      // Check combined done view
      const doneDialog = page
        .getByRole("dialog")
        .filter({ hasText: /Your .* shares have been migrated to/ });
      await expect(doneDialog).toBeVisible();

      // Open receipt from done card
      await page.getByRole("button", { name: "View Migrate Receipt" }).click();

      const receiptModal = page.getByRole("dialog", { name: "Migrate Receipt", exact: true });
      await expect(receiptModal).toBeVisible();
      await expect(receiptModal).toContainText("Share-true comparison");

      const copyBtn = receiptModal.getByRole("button", { name: "Copy Migrate Receipt Link" });
      await expect(copyBtn).toBeVisible();

      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await copyBtn.click({ force: true });

      const handle = await page.evaluateHandle(() => navigator.clipboard.readText());
      const copied = await handle.jsonValue();
      expect(copied).toMatch(/\/receipt\/migrate\/0x[a-f0-9]{64}\/0x[a-f0-9]{64}/);
    });
  });
});

test("hides when flag is off", async ({ page }) => {
  await flags(page, false);
  await mockWallet(page);
  await page.goto("/portfolio");

  // Check that Migrate is not available
  await expect(page.getByTestId("migrate-NVDAB")).not.toBeVisible();
});

test("blocks ineligible cases", async ({ page }) => {
  await flags(page, true);
  await mockWallet(page);
  await page.route("**/api/portfolio*", (route) => {
    route.fulfill({
      json: {
        address: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
        asOf: new Date().toISOString(),
        groups: [
          {
            ticker: "AAPL",
            shares: 10,
            valueUsd: 1500,
            referencePrice: 150,
            parts: [
              {
                ticker: "AAPL",
                symbol: "AAPLx",
                issuer: "xstocks",
                address: "0x123",
                tokens: 10,
                shares: 10,
                valueUsd: 1500,
                multiplier: 1,
              },
            ],
          },
          {
            ticker: "TSLA",
            shares: 0.01,
            valueUsd: 2,
            referencePrice: 200,
            parts: [
              {
                ticker: "TSLA",
                symbol: "TSLAB",
                issuer: "bstock",
                address: "0x456",
                tokens: 0.01,
                shares: 0.01,
                valueUsd: 2,
                multiplier: 1,
              },
            ],
          },
        ],
        totalValueUsd: 1502,
        wallet: { usdt: 10, bnb: 1 },
        failed: [],
      },
    });
  });
  await page.goto("/portfolio");

  // xStocks (AAPL) are completely hidden for migration in portfolio view
  await expect(page.getByTestId("migrate-AAPLx")).not.toBeVisible();

  // TSLAB is too small (< 6 USDT) so it is shown but disabled
  const migrateDustBtn = page.getByTestId("migrate-TSLAB");
  await expect(migrateDustBtn).toBeVisible();
  await expect(migrateDustBtn).toBeDisabled();

  // Hover over the TSLAB disabled button to check the tooltip reason
  await migrateDustBtn.hover({ force: true });
  await expect(page.getByRole("tooltip")).toContainText(
    "Too small to migrate: the buy needs at least 6 USDT. You can sell to USDT instead.",
  );
});

test("resumes after reload", async ({ page }) => {
  await flags(page, true);
  await mockWallet(page);

  // set localStorage manually
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tally.pendingMigrate",
      JSON.stringify({
        id: "test",
        ticker: "NVDA",
        from: "ondo",
        to: "bstock",
        step: 1,
        saleHash: "0xabc",
        createdAt: Date.now(),
      }),
    );
  });

  await stubReceipts(page, 200, "unreconciled");
  await page.goto("/portfolio");

  // Should auto open interstitial
  await expect(
    page.getByRole("dialog").filter({ hasText: "Waiting for the sale to confirm..." }),
  ).toBeVisible();
});

test("rounds down to cent when passing USDT to buy step", async ({ page }) => {
  await flags(page, true);
  await mockWallet(page);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tally.pendingMigrate",
      JSON.stringify({
        id: "test",
        ticker: "NVDA",
        from: "ondo",
        to: "bstock",
        step: 2,
        usdtReceived: "6126000000000000000",
        saleHash: "0xabc",
        createdAt: Date.now(),
      }),
    );
  });

  let requestedUsd: number | undefined;
  await page.route("**/api/trade/plan*", async (route) => {
    const postData = JSON.parse(route.request().postData() || "{}");
    requestedUsd = postData.usd;

    const p = {
      status: "ready",
      builtAt: Date.now(),
      expiresAt: Date.now() + 10000,
      ticker: "NVDA",
      issuer: "bstock",
      symbol: "NVDAB",
      stock: "0xstock",
      guard: "0xguard",
      tolerancePct: 1,
      amountInUsdt: "6120000000000000000",
      tokensOut: "20000000000000000",
      quotedShares: "20000000000000000",
      minShares: "19900000000000000",
      multiplier: "1000000000000000000",
      usdPerShare: 350.0,
      referencePrice: 350.0,
      premium: 0,
      routeText: "USDT -> NVDAB",
      hops: 1,
      vendor: "LiquidMesh",
      feedUpdate: true,
      warnings: [],
      balances: { usdt: "10000000000000000000", bnb: "10000000000000000000" },
      tx: {
        to: "0xrouter",
        data: "0x",
        value: "0x0",
        gasEstimate: "300000",
        gasLimit: "375000",
        gasPriceWei: "1000000000",
        feeUsd: 0.1,
        deadline: Date.now() + 10000,
        chainId: 56,
      },
    };
    await route.fulfill({ json: p });
  });

  await page.goto("/portfolio");
  await page.getByRole("button", { name: "Buy now" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "Review your buy" })).toBeVisible();

  expect(requestedUsd).toBe(6.12);
});

test("pending-forever falls to typed amount after the cap, cancel and resume work", async ({
  page,
}) => {
  await flags(page, true);
  await mockWallet(page);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tally.pendingMigrate",
      JSON.stringify({
        id: "test",
        ticker: "NVDA",
        from: "ondo",
        to: "bstock",
        step: 1,
        saleHash: "0xabc",
        createdAt: Date.now(),
        // mock it to be 121 seconds ago
        pollStartedAt: Date.now() - 121000,
      }),
    );
  });

  await page.route("**/api/receipts*", async (route) => {
    await route.fulfill({ json: { state: "pending" } });
  });

  await page.goto("/portfolio");

  // It should immediately fall back to the typed amount because of the pollStartedAt being old
  await expect(
    page.getByRole("dialog").filter({ hasText: "We could not confirm the amount automatically" }),
  ).toBeVisible();

  // Test that "Cancel" works
  const cancelBtn = page.getByRole("button", { name: "Cancel" });
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("failed sale says it did not go through and clears", async ({ page }) => {
  await flags(page, true);
  await mockWallet(page);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tally.pendingMigrate",
      JSON.stringify({
        id: "test",
        ticker: "NVDA",
        from: "ondo",
        to: "bstock",
        step: 1,
        saleHash: "0xabc",
        createdAt: Date.now(),
        pollStartedAt: Date.now(),
      }),
    );
  });

  await page.route("**/api/receipts*", async (route) => {
    await route.fulfill({ json: { state: "failed" } });
  });

  await page.goto("/portfolio");

  await expect(
    page
      .getByRole("dialog")
      .filter({ hasText: "The sale transaction failed and did not go through." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test.describe("Migrate stocks tab on the Trade page", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("flag on: the tab lists holdings and starts the same migration", async ({ page }) => {
    await flags(page, true);
    await mockWallet(page);
    await stubSell(page, plan("ready"));
    await stubStatus(page);
    await stubReceipts(page);
    await stubBuy(page);
    await page.goto("/trade");
    await page.getByRole("radio", { name: "Migrate stocks" }).click();
    const tab = page.getByTestId("migrate-tab");
    await expect(tab).toBeVisible();
    const btn = tab.getByTestId("migrate-NVDAB");
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await expect(btn).toContainText("Migrate to NVDAon");
    await btn.click();
    await expect(page.getByRole("dialog").filter({ hasText: "Sell NVDAB" })).toBeVisible();
    // Back on the trade tab nothing was lost.
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Buy & sell" }).click();
    await expect(page.getByTestId("trade-card")).toBeVisible();
  });

  test("flag off: no tabs", async ({ page }) => {
    await flags(page, false);
    await mockWallet(page);
    await page.goto("/trade");
    await expect(page.getByTestId("trade-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("radio", { name: "Migrate stocks" })).toHaveCount(0);
  });
});
