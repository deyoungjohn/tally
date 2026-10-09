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

async function stubSaleProceeds(
  page: Page,
  state: "confirmed" | "failed" | "unrecognised" | "pending" = "confirmed",
  usdtReceivedRaw = "6990000000000000000",
  fixture = false,
) {
  await page.route("**/api/trade/sale-proceeds*", async (route) => {
    if (state === "confirmed") {
      await route.fulfill({
        status: 200,
        json: {
          state: "confirmed",
          usdtReceivedRaw,
          tokensSpentRaw: "2500000000000000000",
          stockToken: STOCK,
          blockNumber: 123456,
          fixture,
        },
      });
    } else {
      await route.fulfill({
        status: 200,
        json: { state },
      });
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

/** The target's live quote, as the review reads it (the recorded fixtures have no quote for an arbitrary amount). */
async function stubQuote(page: Page) {
  await page.route("**/api/quote*", (route) =>
    route.fulfill({
      json: {
        ticker: "NVDA",
        referencePrice: 350,
        asOf: new Date().toISOString(),
        session: "regular",
        rows: [
          {
            symbol: "NVDAon",
            issuer: "ondo",
            executable: true,
            shares: 0.0199,
            usdPerShare: 350,
            feeUsd: 0.11,
            isBest: true,
            flags: [],
            gradeReasons: [],
          },
        ],
        warnings: [],
      },
    }),
  );
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
      await stubSaleProceeds(page);
      await stubReceipts(page);
      await stubBuy(page);
      await stubQuote(page);

      await page.goto("/portfolio");

      // Click Migrate button for NVDAB
      const migrateBtn = page.getByTestId("migrate-NVDAB");
      await expect(migrateBtn).toBeVisible({ timeout: 20_000 });
      await migrateBtn.click();

      // The review comes first: what is sold, what is received, the fees and the target. Nothing has been sent yet.
      const review = page.getByTestId("migrate-review");
      await expect(review).toBeVisible();
      await expect(review.getByTestId("mr-sell")).toContainText("NVDAB");
      await expect(review.getByTestId("mr-usdt")).toContainText("about");
      await expect(review.getByTestId("mr-buy")).toContainText("NVDAon");
      await expect(review.getByTestId("mr-fees")).toContainText("$");
      // Confirm sells the whole holding by itself (sell all, sign, mine), then the buy review follows without more clicks.
      await page.getByTestId("migrate-review-confirm").click();

      // Check buy sheet title
      await expect(page.getByRole("dialog").filter({ hasText: "Review your buy" })).toBeVisible();

      // Confirm buy
      await page.getByTestId("confirm-buy").click();

      // Check combined done view
      const doneDialog = page
        .getByRole("dialog")
        .filter({ hasText: /Your .* shares have been migrated to/ });
      await expect(doneDialog).toBeVisible();

      // The receipt button opens the receipt page in a new tab.
      const receiptLink = page.getByTestId("migrate-receipt-link");
      await expect(receiptLink).toHaveAttribute("target", "_blank");
      await expect(receiptLink).toHaveAttribute(
        "href",
        /\/receipt\/migrate\/0x[a-f0-9]{64}\/0x[a-f0-9]{64}/,
      );
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
        wallet: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
        ticker: "NVDA",
        from: "ondo",
        to: "bstock",
        step: 1,
        saleHash: "0xabc",
        createdAt: Date.now(),
      }),
    );
  });

  await stubSaleProceeds(page, "pending");
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
        wallet: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
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

test.describe("Migrate review", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("Cancel sends nothing; a refused sale is explained and cannot be confirmed", async ({
    page,
  }) => {
    await flags(page, true);
    await mockWallet(page);
    await stubQuote(page);
    let sold = 0;
    await page.route("**/api/trade/sell", (route) => {
      sold++;
      return route.fulfill({
        status: 422,
        json: { error: { kind: "rfq_required", message: "This issuer needs a signed order." } },
      });
    });
    await page.goto("/portfolio");
    await page.getByTestId("migrate-NVDAB").click({ timeout: 20_000 });
    await expect(page.getByTestId("migrate-review-error")).toBeVisible();
    await expect(page.getByTestId("migrate-review-confirm")).toHaveCount(0);
    expect(sold).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("migrate-review")).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem("tally.pendingSell"))).toBeNull();
  });
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
        wallet: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
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

  await stubSaleProceeds(page, "pending");
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
        wallet: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
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

  await stubSaleProceeds(page, "failed");
  await page.route("**/api/receipts*", async (route) => {
    await route.fulfill({ json: { state: "failed" } });
  });

  await page.goto("/portfolio");

  await expect(
    page
      .getByRole("dialog")
      .filter({ hasText: "The sale transaction failed and did not go through." }),
  ).toBeVisible({ timeout: 10000 });

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("Migrate appears only for stocks with both issuers enabled", async ({ page }) => {
  await flags(page, true);
  await mockWallet(page);
  const part = (symbol: string, issuer: string, address: string) => ({
    ticker: "NFLX",
    symbol,
    issuer,
    address,
    tokens: 10,
    shares: 10,
    valueUsd: 500,
    multiplier: 1,
    grade: "A",
  });
  await page.route("**/api/portfolio*", (route) =>
    route.fulfill({
      json: {
        address: USER,
        asOf: new Date().toISOString(),
        groups: [
          {
            ticker: "NFLX",
            shares: 20,
            valueUsd: 1000,
            referencePrice: 50,
            parts: [part("NFLXon", "ondo", "0x01"), part("NFLXB", "bstock", "0x02")],
          },
        ],
        totalValueUsd: 1000,
        wallet: { usdt: 10, bnb: 0.1 },
        failed: [],
      },
    }),
  );
  await page.goto("/portfolio");
  await expect(page.getByTestId("group-NFLX")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("migrate-NFLXon")).toHaveCount(0);
  await expect(page.getByTestId("migrate-NFLXB")).toHaveCount(0);
  // Buy more names an enabled issuer only (NFLX is enabled for Ondo).
  await expect(page.getByRole("link", { name: /Buy more NFLXon/ })).toBeVisible();
});

test.describe("Migrate stocks tab on the Trade page", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("flag on: the tab lists holdings and starts the same migration", async ({ page }) => {
    await flags(page, true);
    await mockWallet(page);
    await stubSell(page, plan("ready"));
    await stubStatus(page);
    await stubSaleProceeds(page);
    await stubReceipts(page);
    await stubBuy(page);
    await stubQuote(page);
    await page.goto("/trade");
    await page.getByRole("radio", { name: "Migrate stocks" }).click();
    const tab = page.getByTestId("migrate-tab");
    await expect(tab).toBeVisible();
    const btn = tab.getByTestId("migrate-NVDAB");
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await expect(btn).toContainText("Migrate to NVDAon");
    await btn.click();
    await expect(page.getByTestId("migrate-review")).toBeVisible();
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

test("stopped receipts worker still completes migration through chain route", async ({ page }) => {
  await flags(page, true);
  await mockWallet(page);
  await stubSell(page, plan("ready"));
  await stubStatus(page);
  // Receipts worker is stopped/dead (returns 500)
  await page.route("**/api/receipts*", (route) => route.fulfill({ status: 500 }));
  // Chain route answers confirmed
  await stubSaleProceeds(page, "confirmed", "6990000000000000000");
  await stubBuy(page);
  await stubQuote(page);

  await page.goto("/portfolio");
  const migrateBtn = page.getByTestId("migrate-NVDAB");
  await expect(migrateBtn).toBeVisible({ timeout: 20_000 });
  await migrateBtn.click();

  await page.getByTestId("migrate-review-confirm").click();

  // Review your buy should appear directly because chain route confirmed proceeds
  await expect(page.getByRole("dialog").filter({ hasText: "Review your buy" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("confirm-buy").click();

  const doneDialog = page
    .getByRole("dialog")
    .filter({ hasText: /Your .* shares have been migrated to/ });
  await expect(doneDialog).toBeVisible();
});

test("reload-and-resume of an old sale in fixture mode recognises pseudo hash and proceeds to buy", async ({
  page,
}) => {
  await flags(page, true);
  await mockWallet(page);
  const fixtureSaleHash = "0xf111111111111111111111111111111111111111111111111111111111111111";

  // Simulate an old sale stored in localStorage hours ago
  await page.addInitScript(
    ([hash]) => {
      window.localStorage.setItem(
        "tally.pendingMigrate",
        JSON.stringify({
          id: "mig-old",
          wallet: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
          ticker: "NVDA",
          from: "bstock",
          to: "ondo",
          step: 1,
          saleHash: hash,
          createdAt: Date.now() - 3600_000,
          pollStartedAt: Date.now() - 3600_000,
        }),
      );
    },
    [fixtureSaleHash] as const,
  );

  // Receipts worker is stopped/dead
  await page.route("**/api/receipts*", (route) => route.fulfill({ status: 500 }));
  // Chain route is NOT stubbed via page.route: it queries the Next.js server route, which recognises 0xf11... in fixture mode!
  await stubBuy(page);
  await stubQuote(page);

  await page.goto("/portfolio");

  // The old sale is immediately resolved by the server chain route and auto-advances to the buy step
  await expect(page.getByRole("dialog").filter({ hasText: "Review your buy" })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId("confirm-buy").click();

  const doneDialog = page
    .getByRole("dialog")
    .filter({ hasText: /Your .* shares have been migrated to/ });
  await expect(doneDialog).toBeVisible();
});

test("pending migrate bound to wallet: old shape without wallet property is discarded safely", async ({
  page,
}) => {
  await flags(page, true);
  await mockWallet(page);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tally.pendingMigrate",
      JSON.stringify({
        id: "mig-old",
        ticker: "NVDA",
        from: "ondo",
        to: "bstock",
        step: 1,
        saleHash: "0xabc",
        createdAt: Date.now(),
      }),
    );
  });

  await page.goto("/portfolio");

  // Storage should have removed the old shape
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("tally.pendingMigrate")), {
      timeout: 5000,
    })
    .toBeNull();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("pending migrate bound to wallet: saved migration for different wallet is ignored and removed", async ({
  page,
}) => {
  await flags(page, true);
  await mockWallet(page);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tally.pendingMigrate",
      JSON.stringify({
        id: "mig-other",
        wallet: "0x1111111111111111111111111111111111111111",
        ticker: "NVDA",
        from: "ondo",
        to: "bstock",
        step: 1,
        saleHash: "0xabc",
        createdAt: Date.now(),
      }),
    );
  });

  await page.goto("/portfolio");

  // Storage should have removed the migration for the different wallet
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("tally.pendingMigrate")), {
      timeout: 5000,
    })
    .toBeNull();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("confirmed sale under 6 USDT gives its own message and offers no buy", async ({ page }) => {
  await flags(page, true);
  await mockWallet(page);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tally.pendingMigrate",
      JSON.stringify({
        id: "mig-small",
        wallet: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
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

  // sale proceeds returns confirmed with 5 USDT (under 6 USDT)
  await stubSaleProceeds(page, "confirmed", "5000000000000000000");

  await page.goto("/portfolio");

  // Should display the under minimum message
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("under the 6 USDT minimum required to buy");
  await expect(dialog).toContainText("Your USDT is in your wallet. No buy was placed.");

  // Click Done dismisses and clears
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();

  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("tally.pendingMigrate")), {
      timeout: 5000,
    })
    .toBeNull();
});

test("fixture response shows fixture data in the UI", async ({ page }) => {
  await flags(page, true);
  await mockWallet(page);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tally.pendingMigrate",
      JSON.stringify({
        id: "mig-fixture",
        wallet: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
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

  // returns confirmed with fixture: true and under minimum to inspect interstitial
  await stubSaleProceeds(page, "confirmed", "5000000000000000000", true);

  await page.goto("/portfolio");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("fixture data");
});
