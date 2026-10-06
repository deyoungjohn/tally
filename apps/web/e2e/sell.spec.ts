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

const flags = (page: Page, sell: boolean, receipts = false) =>
  page.route("**/api/modules/health", (route) =>
    route.fulfill({ json: { health: [], flags: { sell, receipts } } }),
  );

type Hint = {
  kind: string;
  txHash: string;
  intentId: string;
  user: string;
  isResumed: boolean;
  ticker: string;
};
/** Stubs POST /api/receipts and records every body. `status` lets a test answer 404 or 500. */
async function stubReceipts(page: Page, status = 200) {
  const hints: Hint[] = [];
  await page.route("**/api/receipts", async (route) => {
    if (route.request().method() === "POST") hints.push(route.request().postDataJSON() as Hint);
    await route.fulfill({ status, json: status === 200 ? { ok: true } : { error: "x" } });
  });
  return hints;
}

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
    const hints = await stubReceipts(page);
    const urls: string[] = [];
    page.on("request", (r) => urls.push(new URL(r.url()).pathname));

    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.025");
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
    await expect(sheet).toContainText("Confirmed on-chain");
    await expect(sheet).not.toContainText("receipts are coming");
    await expect(sheet).not.toContainText(/you received/i);
    // Gas is shown in dollars (0.031 estimated at the 390000 limit, 281000 used), with the unit count kept for agents.
    await expect(sheet.getByTestId("sell-fee")).toContainText("$0.022");
    await expect(sheet.getByTestId("sell-fee")).toHaveAttribute("data-gas-used", "281000");
    await expect(sheet).not.toContainText("Gas used");
    await expect(sheet.getByTestId("sell-hash")).toHaveAttribute("href", /bscscan\.com\/tx\/0x/);
    expect(urls.some((u) => u.startsWith("/api/trade/receipt"))).toBe(false);
    // Exactly one receipt hint for the sale, with the sale's hash.
    await expect.poll(() => hints.length).toBe(1);
    expect(hints[0]).toMatchObject({
      kind: "sell",
      txHash: HASH,
      user: USER,
      ticker: "NVDA",
      isResumed: false,
    });
    expect(hints[0]!.intentId).toBeTruthy();
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
    const hints = await stubReceipts(page);
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.025");
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
    expect(hints).toHaveLength(0); // the approval never posts a hint
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-confirmed")).toBeVisible({ timeout: 20_000 });
    txs = await sent(page);
    expect(txs).toHaveLength(2);
    expect(txs[1]).toMatchObject({ to: ROUTER, value: "0" });
    await expect.poll(() => hints.length).toBe(1);
    expect(hints[0]!.txHash).toBe(HASH);
    expect(hints[0]!.txHash).not.toBe(APPROVE_HASH);
  });

  test("a failing /api/receipts (404 or 500) does not change the sale's outcome", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    await stubSell(page, () => ({ json: plan() }));
    await stubStatus(page, ["success"]);
    const hints = await stubReceipts(page, 404);
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.025");
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-confirmed")).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByTestId("sell-failed")).toHaveCount(0);
    expect(hints).toHaveLength(1);
  });

  test("a sale resumed after a reload posts one hint with isResumed true", async ({ page }) => {
    await mockWallet(page);
    await flags(page, true);
    await stubStatus(page, ["success"]);
    const hints = await stubReceipts(page);
    await page.addInitScript(
      ([hash, user, stock]) => {
        localStorage.setItem(
          "tally.pendingSell",
          JSON.stringify({
            hash,
            ticker: "NVDA",
            symbol: "NVDAB",
            at: Date.now(),
            intent: {
              id: "resumed-intent",
              issuer: "bstock",
              stock,
              user,
              tokensIn: "10000000000000000",
              minUsdtOut: "2316600000000000000",
              tolerancePct: 1,
            },
            fee: { usd: 0.031, limit: "375000" },
          }),
        );
      },
      [HASH, USER, STOCK] as const,
    );
    await page.goto("/portfolio");
    await expect(page.getByTestId("sell-confirmed")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => hints.length).toBe(1);
    expect(hints[0]).toMatchObject({
      kind: "sell",
      txHash: HASH,
      intentId: "resumed-intent",
      isResumed: true,
    });
  });

  test("the recorder runs only when the receipts flag is on", async ({ page }) => {
    for (const on of [false, true]) {
      const ctx = await page
        .context()
        .browser()!
        .newContext({ viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      await mockWallet(p);
      await flags(p, false, on);
      const hints = await stubReceipts(p);
      await p.goto("/trade/NVDA");
      await expect(p.getByTestId("you-get")).toContainText("0.0", { timeout: 15_000 });
      await p.getByTestId("buy-button").click();
      await p.getByTestId("confirm-buy").click({ timeout: 20_000 });
      await expect(p.getByTestId("receipt")).toBeVisible({ timeout: 20_000 });
      await p.waitForTimeout(1_500);
      if (on) expect(hints.length).toBeGreaterThan(0);
      else expect(hints).toHaveLength(0);
      await ctx.close();
    }
  });

  test("needs funds: shows the shortfall and offers no way to send", async ({ page }) => {
    await mockWallet(page);
    await flags(page, true);
    await stubSell(page, (b, n) => ({ json: n === 1 ? plan() : plan({ status: "needs_funds" }) }));
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.025");
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
    await sheet.getByTestId("sell-shares").fill("0.025");
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
    await sheet.getByTestId("sell-shares").fill("0.025");
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-error")).toContainText(
      "You cancelled in your wallet. Nothing was sold.",
    );
    expect(hashes).toHaveLength(0);
    expect(await sent(page)).toHaveLength(0);
    await expect(sheet.getByTestId("sell-confirm")).toBeEnabled();
  });

  test("quotes refresh by themselves, with no button to ask for one", async ({ page }) => {
    await mockWallet(page);
    await flags(page, true);
    const bodies = await stubSell(page, () => ({ json: plan({ expiresInMs: 5_000 }) }));
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.025");
    await expect(sheet.getByTestId("sell-plan")).toBeVisible();
    await expect(sheet.getByTestId("sell-auto-refresh")).toHaveText(
      "Quotes refresh automatically every 15s",
    );
    await expect(sheet.getByRole("button", { name: "Get a new quote" })).toHaveCount(0);
    await expect(sheet).not.toContainText("expired");
    const before = bodies.length;
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBeGreaterThan(before + 1);
    await expect(sheet.getByTestId("sell-confirm")).toBeEnabled();
  });

  test("errors never show internals", async ({ page }) => {
    await mockWallet(page);
    await flags(page, true);
    await stubSell(page, (b, n) =>
      n === 3
        ? {
            status: 502,
            json: {
              error: { kind: "internal", message: "ECONNRESET https://secret.example/rpc?key=abc" },
            },
          }
        : { json: plan() },
    );
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-shares").fill("0.025");
    await expect(sheet.getByTestId("sell-confirm")).toBeEnabled();
    await sheet.getByTestId("sell-confirm").click(); // the fresh plan at confirm is request 3
    await expect(sheet.getByTestId("sell-error")).toContainText(
      "Something went wrong. Nothing was sold.",
    );
    await expect(sheet).not.toContainText("secret.example");
    await expect(sheet).not.toContainText("ECONNRESET");
  });

  test("the input is typable after Sell all, and the slider sets a share of the holding", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    const bodies = await stubSell(page, (b) => ({
      json: plan({ tokensIn: b.tokens ?? "10000000000000000" }),
    }));
    const sheet = await openSheet(page);
    await sheet.getByTestId("sell-all").click();
    await expect(sheet.getByTestId("sell-all")).toHaveText("Selling all");
    await expect(sheet.getByTestId("sell-shares")).toBeEditable();
    await sheet.getByTestId("sell-shares").fill("0.025");
    await expect(sheet.getByTestId("sell-all")).toHaveText("Sell all");
    await expect(sheet.getByTestId("sell-slider-available")).toContainText("shares in your wallet");
    const slider = sheet.getByTestId("sell-slider-input");
    await slider.fill("50");
    await expect(sheet.getByTestId("sell-shares")).not.toHaveValue("0.01");
    const half = Number(await sheet.getByTestId("sell-shares").inputValue());
    await slider.fill("100");
    await expect(sheet.getByTestId("sell-all")).toHaveText("Selling all");
    await expect.poll(() => bodies.at(-1)?.tokens).toBe(RAW_BALANCE);
    expect(half).toBeGreaterThan(0);
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
      await sheet.getByTestId("sell-shares").fill("0.025");
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
