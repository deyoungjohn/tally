import { expect, test } from "@playwright/test";

for (const width of [375, 768, 1280]) {
  test(`plain preview shows allocation, unavailable tickers and partial state at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dev/pies");
    await expect(page.getByRole("heading", { name: "Pies preview" })).toBeVisible();
    await expect(page.getByText("MSFT is not buyable")).toBeVisible();
    await expect(page.getByText("partially rebalanced", { exact: true })).toBeVisible();
    await expect(page.getByText(/Stale snapshot: 600000 ms/)).toBeVisible();
    await expect(page.getByText(/preview-sell-receipt/)).toBeVisible();
    await expect(page.getByText(/pending$/)).toBeVisible();
    await page.screenshot({ path: `test-results/pies-${width}.png`, fullPage: true });
  });
}
test("plain preview works with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dev/pies");
  await expect(page.getByRole("region", { name: "Rebalance plan", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/pies-reduced-motion.png", fullPage: true });
});
