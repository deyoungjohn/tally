import { expect, test } from "@playwright/test";

const CONCEPTS = [
  "shares",
  "guarantee",
  "slippage",
  "premium",
  "liquidity",
  "not-tradable",
  "unit-trap",
  "fee",
  "radar",
  "portfolio",
  "grades",
] as const;

test.describe("How it works (the end-user page)", () => {
  test("every Learn more anchor exists and the page has no contract details", async ({ page }) => {
    await page.goto("/how-it-works");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tokenized stocks");
    for (const id of CONCEPTS) await expect(page.locator(`#how-${id}`), id).toBeAttached();
    const text = await page.locator("main").innerText();
    // Contracts belong in the developer docs, not in the end-user page.
    expect(text).not.toMatch(/ShareGuard|0x[0-9a-fA-F]{8}/);
    expect(await page.locator('a[href*="bscscan.com"]').count()).toBe(0);
  });

  test("it links to the developer docs, and /docs links back", async ({ page }) => {
    await page.goto("/how-it-works");
    await expect(page.getByRole("link", { name: /Developer docs/ }).last()).toHaveAttribute(
      "href",
      "https://docs.tallyprotocol.xyz",
    );
    await page.goto("/docs");
    await expect(page.locator("main").getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "/how-it-works",
    );
    await expect(page.locator("main #contracts")).toBeAttached();
    await expect(page.locator("main #disclaimer")).toBeAttached();
  });

  for (const w of [375, 768, 1280] as const) {
    test(`fits at ${w}px with reduced motion, no horizontal scroll`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await page.goto("/how-it-works");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await ctx.close();
    });
  }
});
