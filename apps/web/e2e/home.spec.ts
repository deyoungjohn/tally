import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [375, 768, 1280] as const;
const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";

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

for (const width of WIDTHS) {
  test.describe(`home at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("minimalist trade card is live, sections exist, nothing overflows", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("tokenized shares");
      await expect(page.getByTestId("home-get")).toContainText("NVDA shares", { timeout: 15_000 });
      for (const id of ["trade", "portfolio", "radar", "faq"])
        await expect(page.locator(`#${id}`)).toBeAttached();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe("rgb(12, 13, 15)");
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `test-results/home-${width}.png`, fullPage: true });
    });
  });
}

test.describe("home on a 16-inch desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("each feature section fills a screen and has a call to action", async ({ page }) => {
    await page.goto("/");
    for (const [id, cta] of [
      ["trade", "Open Trade"],
      ["portfolio", "Open Portfolio"],
      ["radar", "Open Radar"],
    ] as const) {
      const sec = page.locator(`#${id}`);
      const box = await sec.boundingBox();
      expect(box!.height, id).toBeGreaterThanOrEqual(780);
      await expect(sec.getByRole("link", { name: new RegExp(cta) })).toBeVisible();
    }
  });
});

test.describe("home behaviour", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the stock dropdown changes the quote", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-get")).toContainText("NVDA shares", { timeout: 15_000 });
    await page.getByTestId("home-card").getByTestId("stock-picker").selectOption("AAPL");
    await expect(page.getByTestId("home-get")).toContainText("AAPL shares", { timeout: 15_000 });
  });

  test("Get Started opens the full trade page with the amount", async ({ page }) => {
    await page.goto("/");
    await page
      .getByTestId("home-card")
      .getByRole("link", { name: /Get Started/ })
      .click();
    await expect(page).toHaveURL(/\/trade\/NVDA\?usd=6/);
    await expect(page.getByTestId("trade-card")).toBeVisible();
  });

  test("swapping out to BNB or USDT is shown but disabled", async ({ page }) => {
    await page.goto("/");
    const swap = page.getByTestId("home-card").getByRole("region", { name: "Swap out" });
    await expect(swap).toContainText("Sell to USDT");
    await expect(swap).toContainText("Soon");
    expect(await swap.getByRole("button").count()).toBe(0);
  });

  test("the nav bar turns more opaque once you scroll", async ({ page }) => {
    await page.goto("/");
    const bar = page.locator(".site-bar");
    await expect(bar).toHaveAttribute("data-scrolled", "false");
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar).toHaveAttribute("data-scrolled", "true");
    const bg = await bar.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("0.78");
  });

  test("nav has Trade, Portfolio, Radar, FAQ and Get Started; no Get a quote", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const n of ["Trade", "Portfolio", "Radar", "FAQ"])
      await expect(nav.getByRole("link", { name: n })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Get Started" })).toBeVisible();
    await expect(page.getByText("Get a quote")).toHaveCount(0);
  });

  test("after sign-in the header shows a short wallet address instead of Get Started", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto("/");
    await expect(page.getByTestId("account-button")).toContainText("0xe05f…cfF7");
    await expect(page.getByRole("banner").getByRole("link", { name: "Get Started" })).toHaveCount(
      0,
    );
  });

  test("FAQ is three tabs of dropdown questions", async ({ page }) => {
    await page.goto("/");
    const faq = page.getByTestId("faq-card");
    await expect(faq.getByRole("tab")).toHaveCount(3);
    await expect(faq.getByRole("tab", { name: "Basics" })).toHaveAttribute("aria-selected", "true");
    await faq.getByRole("tab", { name: "Buying" }).click();
    await expect(faq.getByRole("tab", { name: "Buying" })).toHaveAttribute("aria-selected", "true");
    // The first question of a tab opens by itself; open the second.
    await expect(faq.getByRole("tabpanel")).toContainText("Tally adds no fee");
    const q = faq.getByRole("button", { name: "Why is the minimum $6?" });
    await expect(q).toBeVisible();
    await page.waitForTimeout(500);
    await q.click();
    await expect(q).toHaveAttribute("aria-expanded", "true");
    await expect(faq).toContainText("USDT is worth slightly under $1");
    await faq.getByRole("button", { name: "Read the docs" }).click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test("the old tagline is gone and no page links a contract outside the docs", async ({
    page,
  }) => {
    for (const path of ["/", "/trade/NVDA", "/radar", "/portfolio"]) {
      await page.goto(path);
      await page.waitForTimeout(500);
      expect(await page.locator("body").innerText(), path).not.toMatch(/not tokens/i);
      expect(await page.locator('a[href*="bscscan.com/address"]').count(), path).toBe(0);
    }
    await page.goto("/docs");
    await expect(page.locator('a[href*="bscscan.com/address"]').first()).toBeVisible();
  });
});

test.describe("radar and portfolio pages", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("radar grades every token with reasons and filters ghost markets", async ({ page }) => {
    await page.goto("/radar");
    await expect(page.getByTestId("radar-NVDAx")).toContainText("Ghost market", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("radar-NVDAon")).toBeVisible();
    await page.getByRole("radio", { name: "Ghost" }).click();
    await expect(page.getByTestId("radar-NVDAon")).toHaveCount(0);
    await expect(page.getByTestId("radar-NVDAx")).toBeVisible();
  });

  test("portfolio signed in shows holdings in shares across issuers", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/portfolio");
    const g = page.getByTestId("group-NVDA");
    await expect(g).toContainText("NVDAB", { timeout: 20_000 });
    await expect(g).toContainText("NVDAon");
    await expect(g).toContainText("0.051");
    await expect(page.getByTestId("total-value")).toContainText("$");
  });

  test("portfolio signed out shows a labelled example and a sign-in", async ({ page }) => {
    await mockWallet(page, false);
    await page.goto("/portfolio");
    await expect(page.getByText("not a real account")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
