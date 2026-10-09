import { expect, test } from "@playwright/test";

// Token icons: every list shows an icon (the file, or the letter fallback), nothing requests a missing file, nothing overflows.
for (const width of [375, 768, 1280] as const) {
  test.describe(`token icons at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const path of ["/", "/trade", "/trade/AAPL", "/radar"]) {
      test(`${path}: icons or fallbacks, no failed or 404 icon requests, no horizontal scroll`, async ({
        page,
      }) => {
        const bad: string[] = [];
        page.on("response", (r) => {
          if (r.url().includes("/tokens/") && r.status() >= 400)
            bad.push(`${r.status()} ${r.url()}`);
        });
        page.on("requestfailed", (r) => {
          if (r.url().includes("/tokens/")) bad.push(`failed ${r.url()}`);
        });
        await page.goto(path);
        await expect(page.locator(".token-icon").first()).toBeVisible({ timeout: 20_000 });
        // The icon is decorative and fixed-size, so it never shifts the layout.
        const size = await page
          .locator(".token-icon")
          .first()
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            return [Math.round(r.width), Math.round(r.height)];
          });
        expect(size[0]).toBe(size[1]);
        expect([16, 20, 24, 32, 40]).toContain(size[0]);
        await page.waitForTimeout(500);
        expect(bad).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBeLessThanOrEqual(0);
      });
    }

    test("the stock picker lists an icon beside every stock", async ({ page }) => {
      await page.goto("/trade");
      await page.getByTestId("stock-picker").click();
      const options = page.getByRole("option");
      await expect(options.first()).toBeVisible({ timeout: 10_000 });
      const count = await options.count();
      expect(count).toBeGreaterThan(5);
      await expect(page.getByRole("option").locator(".token-icon")).toHaveCount(count);
    });
  });
}
