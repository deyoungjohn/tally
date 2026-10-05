import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [375, 768, 1280] as const;
const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";

/** The app runs on recorded fixtures (TALLY_FIXTURES=1) with a mock wallet: no key, no money, deterministic receipts. */
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

async function quoteLoaded(page: Page) {
  await expect(page.getByTestId("you-get")).toContainText("0.0", { timeout: 15_000 });
}

async function buyThrough(page: Page) {
  await page.getByTestId("buy-button").click();
  // The first buy on a fresh server also needs the exact-amount approval; the mock wallet signs it by itself.
  await expect(page.getByRole("dialog", { name: "Review your buy" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("min-shares")).toContainText("NVDA shares");
  await page.getByTestId("confirm-buy").click();
  await expect(page.getByTestId("receipt")).toBeVisible({ timeout: 20_000 });
}

for (const width of WIDTHS) {
  test.describe(`trade page at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("shows live comparison in shares, no horizontal scroll", async ({ page }) => {
      await mockWallet(page);
      await page.goto("/trade/NVDA");
      await quoteLoaded(page);
      await expect(page.getByTestId("row-NVDAon")).toBeVisible();
      await expect(page.getByTestId("row-NVDAB")).toBeVisible();
      await expect(page.getByTestId("row-NVDAx")).toContainText("Not Tradable");
      await expect(page.getByTestId("row-NVDAon")).toContainText("Best");
      await expect(page.getByTestId("min-received")).toContainText("shares");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/trade-${width}.png`, fullPage: true });
    });

    test("a first-time buyer goes from $6 to a receipt in shares", async ({ page }) => {
      await mockWallet(page);
      await page.goto("/trade/NVDA");
      await quoteLoaded(page);
      await buyThrough(page);
      const receipt = page.getByTestId("receipt");
      await expect(receipt).toContainText("Shares delivered");
      await expect(page.getByTestId("receipt-shares")).toContainText("0.025705");
      await expect(receipt.getByRole("link", { name: /BscScan/ })).toHaveAttribute(
        "href",
        /bscscan\.com\/tx\/0x/,
      );
      await page.screenshot({ path: `test-results/receipt-${width}.png`, fullPage: true });
    });
  });
}

test.describe("sign-in and the region declaration", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test("signed out: 'Sign in to buy', the box must be ticked, then the buy continues", async ({
    page,
  }) => {
    await mockWallet(page, false);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    const buy = page.getByTestId("buy-button");
    await expect(buy).toContainText("Sign in to buy");
    await buy.click();
    const dialog = page.getByRole("dialog", { name: "Create your account" });
    await expect(dialog).toBeVisible();
    const cont = dialog.getByRole("button", { name: "Continue" });
    await expect(cont).toBeDisabled();
    await dialog.getByTestId("declaration").check();
    await expect(cont).toBeEnabled();
    await cont.click();
    await expect(page.getByRole("dialog", { name: "Review your buy" })).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe("amount rules and errors", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("under $6 is refused in plain words and the button is off", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    await page.getByLabel("You pay").fill("5");
    await expect(page.getByRole("alert").filter({ hasText: "Minimum is $6" })).toBeVisible();
    await expect(page.getByTestId("buy-button")).toBeDisabled();
  });

  test("a stock ShareGuard isn't set up for can be compared but not bought", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/trade/NFLX");
    await expect(page.getByTestId("buy-button")).toContainText("Quotes only for now");
    await expect(page.getByTestId("buy-button")).toBeDisabled();
  });

  test("'price moved' from the plan shows the plain message and offers a new quote", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.route("**/api/trade/plan", (r) =>
      r.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            kind: "price_moved",
            message: "The price moved more than your tolerance. Review the new quote.",
          },
        }),
      }),
    );
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    await page.getByTestId("buy-button").click();
    const err = page.getByTestId("flow-error");
    await expect(err).toContainText("price moved more than your tolerance");
    await expect(err.getByRole("button", { name: "Review new quote" })).toBeVisible();
  });

  test("quotes unavailable (region drift) never shows internals", async ({ page }) => {
    await mockWallet(page);
    await page.route("**/api/quote*", (r) =>
      r.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { kind: "quotes_unavailable", message: "Quotes are temporarily unavailable." },
        }),
      }),
    );
    await page.goto("/trade/NVDA");
    await expect(page.getByTestId("quote-error")).toHaveText("Quotes are temporarily unavailable.");
  });

  test("the user cancelling in the wallet spends nothing and says so", async ({ page }) => {
    await page.addInitScript(
      ([address]) => {
        (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
          address,
          signedIn: true,
          reject: true,
        };
      },
      [USER] as const,
    );
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    await page.getByTestId("buy-button").click();
    // The approval (first buy on a fresh server) or the swap signature is rejected: both end in the same words.
    const review = page.getByRole("dialog", { name: "Review your buy" });
    const cancelled = page.getByText(/cancelled in your wallet/i).first();
    await expect(review.or(cancelled)).toBeVisible({ timeout: 20_000 });
    if (await review.isVisible()) await page.getByTestId("confirm-buy").click();
    await expect(cancelled).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("keyboard path", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  test("amount, tolerance, buy and confirm all work from the keyboard; Esc closes the review", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    await page.getByLabel("You pay").focus();
    // Slippage radio group: arrow keys move the choice.
    const tol = page.getByRole("radiogroup", { name: "Slippage" });
    await tol.getByRole("radio", { name: "1%" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tol.getByRole("radio", { name: "2%" })).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(tol.getByRole("radio", { name: "1%" })).toBeChecked();
    // Buy with Enter on the focused button.
    const buy = page.getByTestId("buy-button");
    await buy.focus();
    await page.keyboard.press("Enter");
    const review = page.getByRole("dialog", { name: "Review your buy" });
    await expect(review).toBeVisible({ timeout: 20_000 });
    // Esc closes it and focus returns to the page.
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await buy.focus();
    await page.keyboard.press("Enter");
    await expect(review).toBeVisible({ timeout: 20_000 });
    // Tab stays inside the dialog (focus trap).
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(
      true,
    );
    await page.getByTestId("confirm-buy").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("receipt")).toBeVisible({ timeout: 20_000 });
  });

  test("the 'Why?' disclosure opens with the keyboard", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    const why = page.getByTestId("row-NVDAon").getByRole("button", { name: /Why\?/ });
    await why.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("why-NVDAon")).toContainText("Route:");
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 375, height: 800 }, reducedMotion: "reduce" });
  test("the whole buy works, with no looping animation on the trade page", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter(
          (a) =>
            a.playState === "running" &&
            (a as CSSAnimation).animationName !== undefined &&
            a.effect?.getTiming().iterations === Infinity,
        )
        .map((a) => (a as CSSAnimation).animationName),
    );
    expect(running).toEqual([]);
    await buyThrough(page);
  });
});

test.describe("layout order", () => {
  test("phone: price, then the trade card, then the issuer comparison", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockWallet(page);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    const y = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
    const price = await y("ref-price");
    const card = await y("trade-card");
    const rows = (await page.getByTestId("row-NVDAon").boundingBox())!.y;
    expect(price).toBeLessThan(card);
    expect(card).toBeLessThan(rows);
  });

  test("desktop: the issuer comparison is on the left of the trade card", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockWallet(page);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    const row = (await page.getByTestId("row-NVDAon").boundingBox())!;
    const card = (await page.getByTestId("trade-card").boundingBox())!;
    expect(row.x + row.width).toBeLessThanOrEqual(card.x + 1);
  });

  test("the stock dropdown switches the stock on the trade page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await mockWallet(page);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    await page.getByTestId("stock-picker").click();
    await page.getByRole("option", { name: /AAPL/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Apple");
    await expect(page).toHaveURL(/\/trade\/AAPL/);
  });
});

for (const [w, h] of [
  [375, 800],
  [1280, 900],
] as const) {
  test(`the sign-in dialog is centered at ${w}px and the toggle pills stay put when it closes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    await mockWallet(page, false);
    await page.goto("/trade/NVDA");
    await quoteLoaded(page);
    const pill = page
      .getByRole("radiogroup", { name: "Slippage" })
      .getByRole("radio", { checked: true });
    // Measured against the card: opening the dialog can scroll the page (the card is sticky on desktop), but the pill must not move inside it.
    const top = () =>
      pill.evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          document.querySelector('[data-testid="trade-card"]')!.getBoundingClientRect().top,
      );
    const before = await top();
    await page.getByTestId("buy-button").click();
    const dialog = page.getByRole("dialog", { name: "Create your account" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(700);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - w / 2)).toBeLessThan(2);
    expect(box.y).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThan(h);
    expect(Math.abs(box.y + box.height / 2 - h / 2)).toBeLessThan(60);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Sample for a moment: the pill must not move at all.
    const ys: number[] = [];
    for (let i = 0; i < 10; i++) {
      ys.push(await top());
      await page.waitForTimeout(60);
    }
    for (const y of ys) expect(Math.abs(y - before)).toBeLessThan(1.5);
  });
}
