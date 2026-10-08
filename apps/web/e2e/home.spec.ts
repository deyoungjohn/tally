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
      await expect(page.getByTestId("home-get")).toContainText(/NVDA(on|B) shares/, {
        timeout: 15_000,
      });
      for (const id of ["trade", "portfolio", "radar", "faq"])
        await expect(page.locator(`#${id}`)).toBeAttached();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe("rgb(0, 0, 0)");
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
    await expect(page.getByTestId("home-get")).toContainText(/NVDA(on|B) shares/, {
      timeout: 15_000,
    });
    await page.getByTestId("home-card").getByTestId("stock-picker").click();
    await page.getByRole("option", { name: /AAPL/ }).click();
    await expect(page.getByTestId("home-get")).toContainText(/AAPL(on|B) shares/, {
      timeout: 15_000,
    });
  });

  test("the Home card button opens the full trade page with the amount", async ({ page }) => {
    await page.goto("/");
    await page
      .getByTestId("home-card")
      .getByRole("link", { name: /Buy NVDA/ })
      .click();
    await expect(page).toHaveURL(/\/trade\/NVDA\?usd=6/);
    await expect(page.getByTestId("trade-card")).toBeVisible();
  });

  test("swapping out to BNB or USDT is shown but disabled", async ({ page }) => {
    await page.goto("/");
    const swap = page.getByTestId("home-card").getByRole("region", { name: "Coming soon" });
    await expect(swap).toContainText("Sell to BNB");
    await expect(swap).toContainText("Soon");
    await expect(swap).not.toContainText("Sell to USDT");
    await expect(swap).not.toContainText("Migrate between issuers");
    expect(await swap.getByRole("button").count()).toBe(0);
  });

  test("the nav bar stays nearly clear when you scroll", async ({ page }) => {
    await page.goto("/");
    const bar = page.locator(".site-bar");
    await expect(bar).toHaveAttribute("data-scrolled", "false");
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(bar).toHaveAttribute("data-scrolled", "true");
    const alpha = await bar.evaluate((el) => {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? [];
      return m.length > 3 ? Number(m[3]) : 1;
    });
    expect(alpha).toBeLessThanOrEqual(0.05);
  });

  test("nav has Trade, Portfolio, Radar and Get Started; How it works and FAQ are not in the nav", async ({
    page,
  }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const n of ["Trade", "Portfolio", "Radar"])
      await expect(nav.getByRole("link", { name: n })).toBeVisible();
    await expect(nav.getByRole("link", { name: "How it works" })).toHaveCount(0);
    await expect(page.getByRole("banner").getByRole("link", { name: "Get Started" })).toBeVisible();
    await expect(page.getByText("Get a quote")).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "FAQ" })).toHaveCount(0);
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
    await expect(page.getByTestId("radar-NVDAx")).toContainText("Not Tradable", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("radar-NVDAon")).toBeVisible();
    await page.getByRole("radio", { name: "Not Tradable" }).click();
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

test.describe("real wallet provider (no mock)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  // Regression: an unstable Privy callback once made the app re-render forever (React error #185) and every page showed "This page couldn't load".
  // Needs a build that has a Privy App ID: `NEXT_PUBLIC_PRIVY_APP_ID=clx0000000000000000000000 pnpm build` (any value; it never has to reach Privy).
  for (const path of ["/", "/trade/NVDA", "/radar", "/portfolio"]) {
    test(`${path} stays up with the real provider mounted`, async ({ page }) => {
      const errors: string[] = [];
      let noAppId = false;
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.text().includes("NEXT_PUBLIC_PRIVY_APP_ID is not set")) noAppId = true;
      });
      await page.goto(path);
      await page.waitForTimeout(4000);
      test.skip(noAppId, "this build has no Privy App ID, so the real provider is not mounted");
      expect(errors, errors.join("\n")).toEqual([]);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
    });
  }
});

test.describe("signed-in changes", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("hero buttons are gone once signed in; How it works stays in the footer only", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("hero-actions")).toBeVisible();
    await expect(
      page.getByTestId("hero-actions").getByRole("link", { name: "How it works" }),
    ).toBeVisible();
    await mockWallet(page);
    await page.goto("/");
    await expect(page.getByTestId("account-button")).toBeVisible();
    await expect(page.getByTestId("hero-actions")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "How it works" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "How it works" }),
    ).toBeVisible();
  });

  test("the Home trade button says Buy {ticker}, follows the dropdown, then follows the transaction once signed in", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-action")).toContainText("Buy NVDA");
    await expect(page.getByTestId("home-card").getByTestId("returning-user")).toHaveCount(0);
    await page.getByTestId("home-card").getByTestId("stock-picker").click();
    await page.getByRole("option", { name: /^Apple · AAPLon \/ AAPLB/ }).click();
    await expect(page.getByTestId("home-action")).toContainText("Buy AAPL");
    await mockWallet(page);
    await page.goto("/");
    const action = page.getByTestId("home-action");
    await expect(action).toContainText("Buy NVDA", { timeout: 15_000 });
    await action.click();
    // Approval (first buy on a fresh server) and the swap both show their own words; the review sheet opens before the swap.
    const review = page.getByRole("dialog", { name: "Review your buy" });
    await expect(review).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("confirm-buy").click();
    await expect(action).toContainText("Bought", { timeout: 20_000 });
    await expect(page.getByTestId("receipt")).toBeVisible();
  });

  test("the account menu offers Send and Export, and Send validates the address", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto("/");
    await page.getByTestId("account-button").click();
    await expect(page.getByTestId("menu-export")).toBeVisible();
    await page.getByTestId("menu-send").click();
    const dialog = page.getByRole("dialog", { name: "Send from your wallet" });
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("send-to").fill("0x123");
    await expect(dialog.getByRole("alert")).toContainText("42 characters");
    await expect(dialog.getByTestId("send-review")).toBeDisabled();
    await dialog.getByTestId("send-to").fill("0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930");
    await dialog.getByTestId("send-amount").fill("1");
    await expect(dialog.getByTestId("send-review")).toBeEnabled();
    await dialog.getByTestId("send-review").click();
    await expect(dialog).toContainText("This can't be undone");
    await dialog.getByTestId("send-confirm").click();
    await expect(dialog.getByTestId("send-done")).toBeVisible({ timeout: 10_000 });
  });

  test("Live comparison has a stock dropdown with the five stocks and no '$25 of NVDA' text", async ({
    page,
  }) => {
    await page.goto("/");
    const block = page.getByTestId("home-comparison");
    await expect(block.getByRole("heading", { name: "Live comparison" })).toBeVisible();
    await expect(page.getByText("$25 of NVDA")).toHaveCount(0);
    await block.getByTestId("stock-picker").click();
    // Options carry the tokens' own symbols (never a bare ticker): "NVIDIA · NVDAon / NVDAB".
    for (const [name, t] of [
      ["NVIDIA", "NVDA"],
      ["Apple", "AAPL"],
      ["Tesla", "TSLA"],
      ["Invesco QQQ", "QQQ"],
      ["SPDR S&P 500", "SPY"],
    ] as const)
      await expect(page.getByRole("option", { name: `${name} · ${t}on / ${t}B` })).toBeVisible();
  });

  test("the unit-trap toggle has a pill behind the active choice", async ({ page }) => {
    await page.goto("/");
    const group = page.getByRole("radiogroup", { name: "Show price as" });
    await group.scrollIntoViewIfNeeded();
    await expect(group.getByRole("radio", { name: "Price per token" })).toBeChecked();
    await group.getByRole("radio", { name: "Price per share" }).click();
    await expect(page.getByText("$68.08")).toBeVisible();
    // The pill is one silver gradient element behind the group, sitting exactly under the checked radio.
    await page.waitForTimeout(600);
    const pill = group.locator("span[aria-hidden]").first();
    const bg = await pill.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("linear-gradient");
    const p = (await pill.boundingBox())!;
    const r = (await group.getByRole("radio", { checked: true }).boundingBox())!;
    expect(Math.abs(p.x - r.x)).toBeLessThan(2);
    expect(Math.abs(p.width - r.width)).toBeLessThan(2);
  });

  test("Portfolio uses the new labels", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/portfolio");
    await expect(page.getByText("Total value of tokenized stock holdings")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Other assets in this wallet")).toBeVisible();
  });
});

test.describe("back to top", () => {
  test.use({ viewport: { width: 1280, height: 700 } });
  test("a floating arrow appears after scrolling and returns to the top", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByTestId("back-to-top");
    await expect(btn).toHaveAttribute("data-visible", "false");
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(btn).toHaveAttribute("data-visible", "true");
    const alpha = await btn.evaluate((el) => {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g) ?? [];
      return m.length > 3 ? Number(m[3]) : 1;
    });
    expect(alpha).toBeLessThanOrEqual(0.02);
    await btn.click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  });
});
