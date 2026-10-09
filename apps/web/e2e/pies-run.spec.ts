import { expect, test, type Page } from "@playwright/test";
import { startVmServer, type VmServer } from "./vm-server";

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"b2".padStart(64, "0")}`;
const GUARD = "0x28F6F19bffbF25E36452c78d12090F0bC922970a";
const STOCK = "0x3333333333333333333333333333333333333333";

async function mock(page: Page, controls: { failSecond?: boolean; pending?: boolean }) {
  await page.addInitScript(
    ([address]) => {
      const selected = localStorage.getItem("tally.piesTestWallet") ?? address;
      window.__tallyMockWallet = { address: selected as `0x${string}`, signedIn: true };
    },
    [USER],
  );
  await page.route("**/api/trade/plan", async (route) => {
    const request = route.request().postDataJSON() as {
      ticker: string;
      issuer: string;
      usd: number;
      user: string;
    };
    expect(request.issuer).toBe("bstock");
    expect(request.user.toLowerCase()).toBe(USER);
    expect(request.usd).toBe(6);
    if (controls.failSecond && request.ticker === "AAPL") {
      await route.fulfill({
        status: 409,
        json: { error: { kind: "route_failed", message: "No route for the second leg" } },
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
        balances: { usdt: "18010000000000000000", bnb: "1000000000000000" },
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
  await page.route("**/api/trade/receipt?**", (route) =>
    route.fulfill({
      json: {
        status: controls.pending ? "pending" : "success",
        txHash: HASH,
        bscscan: `https://bscscan.com/tx/${HASH}`,
      },
    }),
  );
  await page.route("**/api/trade/tx-status?**", (route) =>
    route.fulfill({
      json: {
        status: controls.pending ? "pending" : "success",
        hash: HASH,
        bscscan: `https://bscscan.com/tx/${HASH}`,
      },
    }),
  );
}
async function configure(page: Page, server: VmServer) {
  await page.goto(`${server.url}/dev/pies`);
  await expect(page.getByText("Fixture data", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Three-token example" }).check();
  await page.getByRole("textbox", { name: "Budget USDT" }).fill("18.01");
  await expect(page.getByRole("button", { name: "Start basket" })).toBeEnabled();
}
const sent = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __tallySentTxs?: unknown[] }).__tallySentTxs?.length ?? 0,
  );

test.describe("Pies sequential execution with the existing mock wallet", () => {
  test.describe.configure({ mode: "serial" });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3123,
      seed: "health",
      healthModules: ["pies"],
      flags: { FEATURE_PIES: "1", TALLY_DEV_PREVIEWS: "1" },
    });
  });
  test.afterAll(() => server?.stop());

  test("three legs succeed one after another and save every hash", async ({ page }) => {
    await mock(page, {});
    await configure(page, server);
    await page.getByRole("button", { name: "Start basket" }).click();
    await expect(page.getByTestId("pie-status")).toHaveText("done");
    for (const ticker of ["NVDA", "AAPL", "GOOGL"]) {
      await expect(page.getByTestId(`pie-leg-${ticker}`)).toContainText("done");
      await expect(
        page.getByTestId(`pie-leg-${ticker}`).getByRole("link", { name: "Receipt" }),
      ).toHaveAttribute("href", `https://bscscan.com/tx/${HASH}`);
    }
    expect(await sent(page)).toBe(3);
  });

  test("the second failure leaves the first done and third not started, with explicit Continue", async ({
    page,
  }) => {
    const controls = { failSecond: true };
    await mock(page, controls);
    await configure(page, server);
    await page.getByRole("button", { name: "Start basket" }).click();
    await expect(page.getByTestId("pie-leg-NVDA")).toContainText("done");
    await expect(page.getByTestId("pie-leg-AAPL")).toContainText("failed");
    await expect(page.getByTestId("pie-leg-AAPL")).toContainText("No route for the second leg");
    await expect(page.getByTestId("pie-leg-GOOGL")).toContainText("not_started");
    expect(await sent(page)).toBe(1);
    controls.failSecond = false;
    await page.getByRole("button", { name: "Continue with the remaining legs" }).click();
    await expect(page.getByTestId("pie-status")).toHaveText("done");
    expect(await sent(page)).toBe(3);
  });

  test("reload mid-run checks the chain and never re-signs the saved leg", async ({ page }) => {
    const controls = { pending: true };
    await mock(page, controls);
    await configure(page, server);
    await page.getByRole("button", { name: "Start basket" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const run = JSON.parse(localStorage.getItem("tally.pendingPie") ?? "null");
          return run?.legs[0]?.pendingTx?.hash;
        }),
      )
      .toBe(HASH);
    controls.pending = false;
    let chainChecks = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/trade/tx-status")) chainChecks++;
    });
    await page.reload();
    await expect(page.getByTestId("pie-leg-NVDA")).toContainText("done");
    expect(chainChecks).toBeGreaterThan(0);
    expect(await sent(page)).toBe(0);
    await page.getByRole("button", { name: "Continue with the remaining legs" }).click();
    await expect(page.getByTestId("pie-status")).toHaveText("done");
    expect(await sent(page)).toBe(2);
  });

  test("a different wallet ignores and removes a saved run", async ({ page }) => {
    await mock(page, {});
    await configure(page, server);
    await page.getByRole("button", { name: "Start basket" }).click();
    await expect(page.getByTestId("pie-status")).toHaveText("done");
    await page.evaluate((address) => localStorage.setItem("tally.piesTestWallet", address), OTHER);
    await page.reload();
    await expect(page.getByTestId("pie-status")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("tally.pendingPie")))
      .toBeNull();
    expect(await sent(page)).toBe(0);
  });
});
