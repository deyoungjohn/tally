import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Selling, with the wallet mocked and /api/trade/sell and /api/trade/tx-status stubbed: the fixture engine has no stock-to-USDT
 * recordings, and nothing here can move money. The flag is stubbed through /api/modules/health, the way the app reads it.
 */

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";
const STOCK = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"; // NVDAB, the fixture wallet's bStock holding
const ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5";
const RAW_BALANCE = "25654736000000000";
const HASH = `0x${"b2".padStart(64, "0")}`;
const APPROVE_HASH = `0x${"a1".padStart(64, "0")}`;

async function mockWallet(page: Page, extra: { reject?: boolean } = {}) {
  await page.addInitScript(
    ([address, reject]) => {
      (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
        address,
        signedIn: true,
        reject,
      };
    },
    [USER, extra.reject ?? false] as const,
  );
}

const flags = (page: Page, sell: boolean) =>
  page.route("**/api/modules/health", (route) =>
    route.fulfill({ json: { health: [], flags: { sell } } }),
  );

interface PlanOver {
  status?: "ready" | "needs_approval" | "needs_funds";
  minUsdtOut?: string;
  tokensIn?: string;
  expiresInMs?: number;
  gasLimit?: string;
  data?: string;
  warnings?: string[];
}
function plan(o: PlanOver = {}) {
  const status = o.status ?? "ready";
  const tokensIn = o.tokensIn ?? "10000000000000000";
  const base = {
    status,
    builtAt: Date.now(),
    expiresAt: Date.now() + (o.expiresInMs ?? 15_000),
    ticker: "NVDA",
    issuer: "bstock",
    symbol: "NVDAB",
    stock: STOCK,
    user: USER,
    tolerancePct: 1,
    tokensIn,
    sharesIn: "10007780000000000",
    quotedUsdtOut: "2340000000000000000",
    minUsdtOut: o.minUsdtOut ?? "2316600000000000000",
    floorSource: "router",
    multiplier: "1000778000000000000",
    usdPerShare: 233.8,
    referencePrice: 233.9,
    routeText: "NVDAB → USDC → USDT",
    hops: 2,
    vendor: "LiquidMesh",
    balances: { tokens: RAW_BALANCE, bnb: "5000000000000000" },
    warnings: o.warnings ?? [],
  };
  if (status === "needs_funds")
    return {
      ...base,
      shortfall: { tokens: "0", bnb: "1200000000000000", bnbNeeded: "6200000000000000" },
    };
  if (status === "needs_approval")
    return {
      ...base,
      approve: { to: STOCK, spender: ROUTER, data: "0x095ea7b30000", amount: tokensIn },
    };
  return {
    ...base,
    tx: {
      to: ROUTER,
      data: o.data ?? "0xabc123",
      value: "0x0",
      gasEstimate: "300000",
      gasLimit: o.gasLimit ?? "375000",
      gasPriceWei: "3000000000",
      feeUsd: 0.031,
      chainId: 56,
    },
    simulation: { ethCall: "ok", binance: "ok" },
  };
}

type Body = { shares?: number; tokens?: string; tolerancePct?: number; ticker: string };
type Handler = (body: Body, n: number) => { status?: number; json: unknown };

/** Stubs the sell plan route. `handler` sees each request body and its ordinal. Returns the recorded bodies. */
async function stubSell(page: Page, handler: Handler) {
  const bodies: Body[] = [];
  await page.route("**/api/trade/sell", async (route: Route) => {
    const body = route.request().postDataJSON() as Body;
    bodies.push(body);
    const r = handler(body, bodies.length);
    await route.fulfill({ status: r.status ?? 200, json: r.json });
  });
  return bodies;
}

/** Stubs the status route. `statuses` are returned in order; the last repeats. Returns the requested hashes. */
async function stubStatus(page: Page, statuses: ("pending" | "success" | "reverted")[]) {
  const hashes: string[] = [];
  await page.route("**/api/trade/tx-status*", async (route) => {
    const hash = new URL(route.request().url()).searchParams.get("hash")!;
    hashes.push(hash);
    const status = statuses[Math.min(hashes.length - 1, statuses.length - 1)]!;
    await route.fulfill({
      json:
        status === "pending"
          ? { status, hash, bscscan: `https://bscscan.com/tx/${hash}` }
          : {
              status,
              hash,
              blockNumber: 99_000_001,
              gasUsed: 281_000,
              bscscan: `https://bscscan.com/tx/${hash}`,
            },
    });
  });
  return hashes;
}

const sent = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __tallySentTxs?: Record<string, string | null>[] }).__tallySentTxs ??
      [],
  );

async function openSheet(page: Page, symbol = "NVDAB") {
  await page.goto("/portfolio");
  await expect(page.getByTestId("group-NVDA")).toContainText(symbol, { timeout: 20_000 });
  await page.getByTestId(`sell-${symbol}`).click();
  const sheet = page.getByRole("dialog", { name: `Sell ${symbol}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe("sell", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("flag off: no Sell button, nothing else changes", async ({ page }) => {
    await mockWallet(page);
    await flags(page, false);
    await page.goto("/portfolio");
    await expect(page.getByTestId("group-NVDA")).toContainText("NVDAB", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Sell / })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("flag on: every issuer row has Sell, the coming-soon card says Sell to USDT", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    await page.goto("/portfolio");
    await expect(page.getByTestId("sell-NVDAB")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("sell-NVDAon")).toBeVisible();
    const soon = page.getByRole("region", { name: "Coming soon" });
    await expect(soon).toContainText("Sell to USDT");
    await expect(soon).not.toContainText("Sell to USDT or BNB");
  });

  test("a refused token shows the engine's reason in plain words", async ({ page }) => {
    await mockWallet(page);
    await flags(page, true);
    await stubSell(page, () => ({
      status: 409,
      json: {
        error: { kind: "not_buyable", message: "No market to exit this token on BNB Chain." },
      },
    }));
    const sheet = await openSheet(page);
    await expect(sheet.getByTestId("sell-refused")).toContainText(
      "No market to exit this token on BNB Chain.",
    );
  });

  test("ready path: signs exactly the fresh plan's transaction, then says it is confirmed without claiming amounts", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    const bodies = await stubSell(page, (b, n) => ({
      // Request 1 is the opening check, 2 is the typed amount, 3 is the fresh plan at confirm.
      json: n < 3 ? plan() : plan({ data: "0xfeed02", gasLimit: "390000" }),
    }));
    const hashes = await stubStatus(page, ["pending", "success"]);
    const urls: string[] = [];
    page.on("request", (r) => urls.push(new URL(r.url()).pathname));

    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.01");
    await expect(sheet.getByTestId("sell-plan")).toHaveAttribute("data-status", "ready");
    await expect(sheet.getByTestId("sell-sends")).toContainText("0.010007");
    await expect(sheet.getByTestId("sell-min")).toContainText("2.3166 USDT");
    await expect(sheet.getByTestId("sell-sheet")).toContainText("set by the router");
    await expect(sheet.getByTestId("sell-risk")).toBeVisible();
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-confirmed")).toBeVisible({ timeout: 20_000 });

    const txs = await sent(page);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ to: ROUTER, data: "0xfeed02", gas: "390000", value: "0" });
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    expect(hashes[0]).toBe(HASH);
    await expect(sheet).toContainText("Confirmed on-chain. Check your USDT balance");
    await expect(sheet).toContainText("reconciled sell receipts are coming");
    await expect(sheet).not.toContainText(/you received/i);
    await expect(sheet.getByTestId("sell-hash")).toHaveAttribute("href", /bscscan\.com\/tx\/0x/);
    expect(
      urls.some((u) => u.startsWith("/api/trade/receipt") || u.startsWith("/api/receipts")),
    ).toBe(false);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
  });

  test("Sell all sends the raw token balance string from the plan", async ({ page }) => {
    await mockWallet(page);
    await flags(page, true);
    const bodies = await stubSell(page, (b) => ({
      json: plan({ tokensIn: b.tokens ?? "10000000000000000" }),
    }));
    await stubStatus(page, ["success"]);
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-all").click();
    await expect(sheet.getByTestId("sell-plan")).toHaveAttribute("data-status", "ready");
    const last = bodies.at(-1)!;
    expect(last.tokens).toBe(RAW_BALANCE);
    expect(last.shares).toBeUndefined();
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-confirmed")).toBeVisible({ timeout: 20_000 });
    expect(bodies.at(-1)!.tokens).toBe(RAW_BALANCE);
  });

  test("needs approval, then ready: approves the exact amount, waits, re-plans, then sells", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    let approved = false;
    await stubSell(page, (b, n) => ({
      json: n === 1 ? plan() : approved ? plan() : plan({ status: "needs_approval" }),
    }));
    const hashes = await stubStatus(page, ["success"]);
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.01");
    await expect(sheet.getByTestId("sell-needs-approval")).toContainText("exactly");
    await expect(sheet.getByTestId("sell-confirm")).toHaveCount(0);
    approved = true;
    await sheet.getByTestId("sell-approve").click();
    await expect(sheet.getByTestId("sell-confirm")).toBeVisible({ timeout: 20_000 });
    let txs = await sent(page);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ to: STOCK, gas: "80000", value: "0" });
    expect(txs[0]!.data).toBe("0x095ea7b30000"); // the plan's approval calldata, for the plan's exact amount
    expect(hashes[0]).toBe(APPROVE_HASH);
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-confirmed")).toBeVisible({ timeout: 20_000 });
    txs = await sent(page);
    expect(txs).toHaveLength(2);
    expect(txs[1]).toMatchObject({ to: ROUTER, value: "0" });
  });

  test("needs funds: shows the shortfall and offers no way to send", async ({ page }) => {
    await mockWallet(page);
    await flags(page, true);
    await stubSell(page, (b, n) => ({ json: n === 1 ? plan() : plan({ status: "needs_funds" }) }));
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.01");
    await expect(sheet.getByTestId("sell-needs-funds")).toContainText("more BNB for network fees");
    await expect(sheet.getByTestId("sell-needs-funds")).toContainText("0.0012");
    await expect(sheet.getByTestId("sell-confirm")).toHaveCount(0);
    await expect(sheet.getByTestId("sell-approve")).toHaveCount(0);
    await expect(sheet.getByTestId("sell-needs-funds-button")).toBeDisabled();
    expect(await sent(page)).toHaveLength(0);
  });

  test("the plan changes at confirm: new numbers are shown, nothing is signed, then the new plan can be confirmed", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    await stubSell(page, (b, n) => ({
      json:
        n < 3
          ? plan()
          : n === 3
            ? plan({ minUsdtOut: "2200000000000000000" })
            : plan({ minUsdtOut: "2200000000000000000" }),
    }));
    await stubStatus(page, ["success"]);
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.01");
    await expect(sheet.getByTestId("sell-min")).toContainText("2.3166 USDT");
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-notice")).toContainText("quote changed");
    await expect(sheet.getByTestId("sell-min")).toContainText("2.2 USDT");
    expect(await sent(page)).toHaveLength(0);
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-confirmed")).toBeVisible({ timeout: 20_000 });
    expect(await sent(page)).toHaveLength(1);
  });

  test("the wallet rejecting the signature spends nothing and says so", async ({ page }) => {
    await mockWallet(page, { reject: true });
    await flags(page, true);
    await stubSell(page, () => ({ json: plan() }));
    const hashes = await stubStatus(page, ["success"]);
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.01");
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-error")).toContainText(
      "You cancelled in your wallet. Nothing was sold.",
    );
    expect(hashes).toHaveLength(0);
    expect(await sent(page)).toHaveLength(0);
    await expect(sheet.getByTestId("sell-confirm")).toBeEnabled();
  });

  test("an expired quote is labelled, can be renewed, and errors never show internals", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    let n = 0;
    await stubSell(page, () => {
      n++;
      if (n === 3)
        return {
          status: 502,
          json: {
            error: { kind: "internal", message: "ECONNRESET https://secret.example/rpc?key=abc" },
          },
        };
      return { json: plan({ expiresInMs: 1_200 }) };
    });
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.01");
    await expect(sheet.getByTestId("sell-expired")).toBeVisible({ timeout: 8_000 });
    await expect(sheet.getByTestId("sell-confirm")).toBeDisabled();
    await sheet.getByRole("button", { name: "Get a new quote" }).click();
    await expect(sheet.getByTestId("sell-error")).toContainText(
      "Something went wrong. Nothing was sold.",
    );
    await expect(sheet).not.toContainText("secret.example");
    await expect(sheet).not.toContainText("ECONNRESET");
  });

  test("a quote route that is refusing this region shows a plain region message", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    await stubSell(page, () => ({
      status: 503,
      json: {
        error: { kind: "quotes_unavailable", message: "Quotes are temporarily unavailable." },
      },
    }));
    const sheet = await openSheet(page);
    await expect(sheet.getByTestId("sell-refused")).toContainText("unavailable from this region");
  });

  for (const w of [375, 768, 1280] as const) {
    test(`the sheet fits at ${w}px and works with reduced motion`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 800 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await mockWallet(page);
      await flags(page, true);
      await stubSell(page, () => ({
        json: plan({ warnings: ["Binance simulation unavailable (HTTP 500 https://x.example)"] }),
      }));
      await stubStatus(page, ["success"]);
      const sheet = await openSheet(page);
      await sheet.getByTestId("sell-shares").fill("0.01");
      await expect(sheet.getByTestId("sell-plan")).toBeVisible();
      await expect(sheet.getByTestId("sell-warnings")).toContainText("second simulation check");
      await expect(sheet).not.toContainText("x.example");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = (await sheet.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      await sheet.getByTestId("sell-confirm").scrollIntoViewIfNeeded();
      await expect(sheet.getByTestId("sell-confirm")).toBeInViewport();
      await page.screenshot({ path: `test-results/sell-sheet-${w}.png` });
      await ctx.close();
    });
  }
});
