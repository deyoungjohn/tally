import { expect, test, type Page } from "@playwright/test";

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";
const STOCK = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
const ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5";
const HASH = `0x${"b2".padStart(64, "0")}`;
const RAW = "25654736000000000";

async function mockWallet(page: Page, signedIn = true) {
  await page.addInitScript(
    ([address, s]) => {
      (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
        address,
        signedIn: s,
      };
    },
    [USER, signedIn] as const,
  );
}
const flags = (page: Page, f: { sell?: boolean; receipts?: boolean }) =>
  page.route("**/api/modules/health", (route) =>
    route.fulfill({ json: { health: [], flags: { sell: false, receipts: false, ...f } } }),
  );

/** The fixture portfolio with every holding's dollar value replaced, to test the minimum-sale rules. */
const portfolioWorth = (page: Page, usd: number) =>
  page.route("**/api/portfolio*", async (route) => {
    const res = await route.fetch();
    const j = (await res.json()) as {
      groups: { valueUsd: number | null; parts: { valueUsd: number | null }[] }[];
    };
    for (const g of j.groups) {
      g.valueUsd = usd;
      for (const p of g.parts) p.valueUsd = usd;
    }
    await route.fulfill({ json: j });
  });

function plan() {
  return {
    status: "ready",
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
    quotedUsdtOut: "2340000000000000000",
    minUsdtOut: "2316600000000000000",
    floorSource: "router",
    multiplier: "1000778000000000000",
    usdPerShare: 233.8,
    referencePrice: 233.9,
    routeText: "NVDAB → USDT",
    hops: 1,
    vendor: "LiquidMesh",
    balances: { tokens: RAW, bnb: "5000000000000000" },
    tx: {
      to: ROUTER,
      data: "0xabc123",
      value: "0x0",
      gasEstimate: "300000",
      gasLimit: "375000",
      gasPriceWei: "3000000000",
      feeUsd: 0.031,
      chainId: 56,
    },
    simulation: { ethCall: "ok", binance: "ok" },
    warnings: [],
  };
}

test.describe("round 7", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the sell sheet puts Confirm right under the slippage control, above the details", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { sell: true });
    await page.route("**/api/trade/sell", (route) => route.fulfill({ json: plan() }));
    await page.goto("/portfolio");
    await page.getByTestId("sell-NVDAB").click({ timeout: 20_000 });
    const sheet = page.getByRole("dialog", { name: "Sell NVDAB" });
    await sheet.getByTestId("sell-shares").fill("0.025");
    await expect(sheet.getByTestId("sell-plan")).toBeVisible();
    const slip = await sheet.getByRole("radiogroup", { name: "Slippage" }).boundingBox();
    const confirm = await sheet.getByTestId("sell-confirm").boundingBox();
    const details = await sheet.getByTestId("sell-expected").boundingBox();
    expect(confirm!.y).toBeGreaterThan(slip!.y);
    expect(confirm!.y).toBeLessThan(details!.y);
  });

  test("a sale worth under $5: no Confirm, the new message, and nothing was requested", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { sell: true });
    const asked: unknown[] = [];
    await page.route("**/api/trade/sell", async (route) => {
      asked.push(route.request().postDataJSON());
      await route.fulfill({ json: plan() });
    });
    await portfolioWorth(page, 10); // the holding is worth $10, so 0.0257 shares ≈ $10
    await page.goto("/portfolio");
    await page.getByTestId("sell-NVDAB").click({ timeout: 20_000 });
    const sheet = page.getByRole("dialog", { name: "Sell NVDAB" });
    await expect(sheet.getByTestId("sell-shares")).toBeVisible();
    // 0.001 of 0.0257 shares is about $0.39
    await sheet.getByTestId("sell-shares").fill("0.001");
    await expect(sheet.getByTestId("sell-below-min")).toContainText(
      "The sale is below the $5 minimum order. Transaction will fail.",
    );
    await expect(sheet.getByTestId("sell-confirm")).toHaveCount(0);
    // And sliding back up brings the button back; sliding down again takes it away.
    await sheet.getByTestId("sell-slider-input").fill("100");
    await expect(sheet.getByTestId("sell-confirm")).toBeVisible();
    await sheet.getByTestId("sell-slider-input").fill("10");
    await expect(sheet.getByTestId("sell-confirm")).toHaveCount(0);
    await expect(sheet.getByTestId("sell-below-min")).toBeVisible();
  });

  test("Portfolio: Sell is unclickable under $5 with a tooltip that says why", async ({ page }) => {
    await mockWallet(page);
    await flags(page, { sell: true });
    await portfolioWorth(page, 3);
    await page.goto("/portfolio");
    const sell = page.getByTestId("sell-NVDAB");
    await expect(sell).toBeDisabled({ timeout: 20_000 });
    await sell.locator("xpath=..").hover();
    await expect(page.getByRole("tooltip")).toContainText("below the $5 minimum sale");
  });

  test("Portfolio: the token name comes first, bolder and bigger than the issuer", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { sell: false });
    await page.goto("/portfolio");
    const row = page.getByTestId("group-NVDA").locator("ul > li").first();
    await expect(row).toContainText("NVDAB", { timeout: 20_000 });
    const look = (id: string) =>
      page.getByTestId(id).evaluate((e) => {
        const cs = getComputedStyle(e);
        return {
          text: e.textContent,
          size: parseFloat(cs.fontSize),
          weight: Number(cs.fontWeight),
        };
      });
    // Retry until the row has settled: right after load the rows can still be re-rendering.
    await expect.poll(async () => (await look("holding-symbol-NVDAB")).size).toBeGreaterThan(0);
    const sym = await look("holding-symbol-NVDAB");
    const issuer = await look("holding-issuer-NVDAB");
    expect(sym.text).toMatch(/NVDA(B|on)/);
    expect(sym.size).toBeGreaterThan(issuer.size);
    expect(sym.weight).toBeGreaterThan(issuer.weight);
  });

  test("Trade page sell mode: the button is unclickable under the minimum sale", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { sell: true });
    await page.goto("/trade/NVDA");
    await page.getByTestId("flip-button").click();
    await expect(page.getByTestId("trade-slider-available")).toContainText(
      "shares in your wallet",
      {
        timeout: 20_000,
      },
    );
    await page.locator("#amount").fill("0.01"); // about $2.3
    await expect(page.getByTestId("sell-button")).toBeDisabled();
    await expect(page.getByTestId("sell-button")).toContainText("Minimum sale is $5");
    await page.locator("#amount").fill("0.025"); // about $5.8, within the fixture holding
    await expect(page.getByTestId("sell-button")).toBeEnabled();
    await expect(page.getByTestId("sell-button")).toContainText(/Sell NVDA(B|on)/);
  });

  test("the flip button stays centred on the gap between the boxes in both modes", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { sell: true });
    await page.goto("/trade/NVDA");
    const gapOffset = async () => {
      const fields = await page.getByTestId("trade-card").locator(".field").all();
      const a = (await fields[0]!.boundingBox())!;
      const b = (await fields[1]!.boundingBox())!;
      const f = (await page.getByTestId("flip-button").boundingBox())!;
      return Math.abs(f.y + f.height / 2 - (a.y + a.height + b.y) / 2);
    };
    await expect(page.getByTestId("flip-button")).toBeEnabled();
    expect(await gapOffset()).toBeLessThan(2);
    await page.getByTestId("flip-button").click();
    await expect(page.getByTestId("sell-button")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await gapOffset()).toBeLessThan(2);
    // The arrow turns 180 degrees, smoothly (a transition is set on it).
    const icon = page.getByTestId("flip-button").locator("svg");
    expect(await icon.evaluate((e) => getComputedStyle(e).transitionDuration)).not.toBe("0s");
    expect(await icon.evaluate((e) => getComputedStyle(e).rotate)).toBe("180deg");
  });

  test("Home: issuer, price per share and fee sit on one line below the button", async ({
    page,
  }) => {
    await page.goto("/");
    const card = page.getByTestId("home-card");
    const route = card.getByTestId("home-route");
    await expect(route).toContainText("per share", { timeout: 20_000 });
    const btn = (await card.getByTestId("home-action").boundingBox())!;
    const line = (await route.boundingBox())!;
    expect(line.y).toBeGreaterThan(btn.y + btn.height - 1);
    expect(line.height).toBeLessThan(30); // one line
    const ys = await route.locator("> span").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return r.top + r.height / 2;
      }),
    );
    for (const y of ys) expect(Math.abs(y - ys[0]!)).toBeLessThan(3);
  });

  test("the nav bar is nearly clear with a faint blur", async ({ page }) => {
    await page.goto("/");
    const bar = page.locator(".site-bar");
    const read = () =>
      bar.evaluate((el) => {
        const cs = getComputedStyle(el);
        const m = cs.backgroundColor.match(/[\d.]+/g) ?? [];
        return { alpha: m.length > 3 ? Number(m[3]) : 1, filter: cs.backdropFilter };
      });
    const top = await read();
    expect(top.alpha).toBeLessThanOrEqual(0.05);
    const blur = Number(top.filter.match(/blur\((\d+)px/)?.[1] ?? 99);
    expect(blur).toBeLessThanOrEqual(6);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(500);
    const scrolled = await read();
    expect(scrolled.alpha).toBeLessThanOrEqual(0.05);
  });

  test("buttons and the segmented toggle are orange with white text; Learn more is orange", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    const btn = page.getByTestId("buy-button");
    await expect(btn).toBeVisible();
    const bg = await btn.evaluate((e) => getComputedStyle(e).backgroundImage);
    expect(bg).toMatch(/rgb\(255, 122, 61\)|rgb\(240, 78, 19\)/);
    expect(await btn.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(255, 255, 255)");
    const pill = page.getByRole("radiogroup", { name: "Amount unit" }).locator("[data-glide-pill]");
    expect(await pill.evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(
      /rgb\(240, 78, 19\)/,
    );
    const learn = page.getByTestId("trade-card").getByRole("button", { name: "Learn more" });
    expect(await learn.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(255, 131, 80)");
  });

  test("the background is one fixed layer", async ({ page }) => {
    await page.goto("/trade/NVDA");
    const bg = page.locator(".bg");
    expect(await bg.evaluate((e) => getComputedStyle(e).position)).toBe("fixed");
    expect(await bg.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("bg-glow.webp");
    const before = await bg.boundingBox();
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    expect((await bg.boundingBox())!.y).toBe(before!.y);
    const res = await page.request.get("/bg-glow.webp");
    expect(res.status()).toBe(200);
  });

  test("no bare ticker appears as a token name: Home, Trade and the pickers use NVDAon / NVDAB", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    await expect(page.getByTestId("trade-card")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(/\bNVDA\b(?!on|B)/);
  });

  test("a verified sale shows USDT received with Guaranteed at least right under it, in the same unit", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { sell: true, receipts: true });
    await page.route("**/api/trade/sell", (route) => route.fulfill({ json: plan() }));
    await page.route("**/api/trade/tx-status*", (route) =>
      route.fulfill({
        json: {
          status: "success",
          hash: HASH,
          blockNumber: 99_000_001,
          gasUsed: 281_000,
          bscscan: `https://bscscan.com/tx/${HASH}`,
        },
      }),
    );
    let polls = 0;
    await page.route("**/api/receipts*", async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ json: { ok: true } });
      polls++;
      await route.fulfill({
        json:
          polls < 2
            ? { state: "pending", hash: HASH }
            : {
                state: "reconciled",
                hash: HASH,
                usdtReceived: "2.3411",
                usdtReceivedRaw: "2341100000000000000",
                tokensSpent: "0.01",
                diffVsQuoteBps: -30,
              },
      });
    });
    await page.goto("/portfolio");
    await page.getByTestId("sell-NVDAB").click({ timeout: 20_000 });
    const sheet = page.getByRole("dialog", { name: "Sell NVDAB" });
    await sheet.getByTestId("sell-shares").fill("0.025");
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-confirmed")).toBeVisible({ timeout: 20_000 });
    await expect(sheet.getByTestId("sell-receipt-status")).toContainText("Verifying");
    await expect(sheet.getByTestId("sell-received")).toContainText("2.3411 USDT", {
      timeout: 20_000,
    });
    await expect(sheet.getByTestId("sell-floor")).toContainText("2.3166 USDT");
    const r = (await sheet.getByTestId("sell-received").boundingBox())!;
    const f = (await sheet.getByTestId("sell-floor").boundingBox())!;
    expect(f.y).toBeGreaterThan(r.y);
    expect(f.y - r.y).toBeLessThan(60);
  });

  test("with receipts off the sheet claims no amount and says to check the balance", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, { sell: true, receipts: false });
    await page.route("**/api/trade/sell", (route) => route.fulfill({ json: plan() }));
    await page.route("**/api/trade/tx-status*", (route) =>
      route.fulfill({
        json: {
          status: "success",
          hash: HASH,
          blockNumber: 1,
          gasUsed: 1,
          bscscan: "https://bscscan.com/tx/x",
        },
      }),
    );
    await page.route("**/api/receipts*", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 404, body: "" })
        : route.fulfill({ status: 404, body: "" }),
    );
    await page.goto("/portfolio");
    await page.getByTestId("sell-NVDAB").click({ timeout: 20_000 });
    const sheet = page.getByRole("dialog", { name: "Sell NVDAB" });
    await sheet.getByTestId("sell-shares").fill("0.025");
    await sheet.getByTestId("sell-confirm").click();
    await expect(sheet.getByTestId("sell-receipt-status")).toContainText(
      "Check your USDT balance",
      {
        timeout: 20_000,
      },
    );
    await expect(sheet).not.toContainText("USDT received");
  });

  test("receipt after a buy: Guaranteed at least is right below Tokens received, in the same unit", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto("/trade/NVDA");
    await expect(page.getByTestId("you-get")).toContainText("0.0", { timeout: 15_000 });
    await page.getByTestId("buy-button").click();
    await page.getByTestId("confirm-buy").click({ timeout: 20_000 });
    const receipt = page.getByTestId("receipt");
    await expect(receipt).toBeVisible({ timeout: 20_000 });
    const labels = await receipt.locator("dt").allTextContents();
    expect(labels.indexOf("Guaranteed at least")).toBe(labels.indexOf("Tokens received") + 1);
    const got = await receipt.getByTestId("receipt-tokens").textContent();
    const min = await receipt.getByTestId("receipt-min").textContent();
    expect(got).toMatch(/^\d+\.\d{6} NVDA(on|B)$/);
    expect(min).toMatch(/^\d+\.\d{6} NVDA(on|B)$/);
    expect(min!.split(" ")[1]).toBe(got!.split(" ")[1]);
    expect(Number(min!.split(" ")[0])).toBeLessThanOrEqual(Number(got!.split(" ")[0]) + 1e-6);
  });
});
