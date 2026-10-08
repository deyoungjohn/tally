import { test, expect } from "@playwright/test";

test.describe("Migrate Receipt Permalink", () => {
  test.use({ reducedMotion: "reduce" });

  for (const { name, w, h } of [
    { name: "mobile", w: 375, h: 812 },
    { name: "tablet", w: 768, h: 1024 },
    { name: "desktop", w: 1280, h: 800 },
  ]) {
    test(`looks correct at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      
      await page.goto("/dev/migrate-receipt");
      
      // Check it renders correctly
      await expect(page.getByText("10 NVDAB = 10 shares to 10 NVDAon = 10 shares")).toBeVisible();
      await expect(page.getByText("Share-true comparison")).toBeVisible();
      
      // Ensure the share control is visible
      const copyBtn = page.getByRole("button", { name: "Copy Migrate Receipt Link" });
      await expect(copyBtn).toBeVisible();

      await expect(page).toHaveScreenshot(`migrate-receipt-${name}.png`, {
        fullPage: true,
      });
    });
  }

  test("share control copies the exact URL", async ({ page }) => {
    await page.goto("/dev/migrate-receipt");
    const copyBtn = page.getByRole("button", { name: "Copy Migrate Receipt Link" });
    await expect(copyBtn).toBeVisible();

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await copyBtn.click();

    // Check button state changed
    await expect(page.getByText("Link copied")).toBeVisible();

    // Read clipboard
    const handle = await page.evaluateHandle(() => navigator.clipboard.readText());
    const copied = await handle.jsonValue();
    
    // Exact URL based on the mock data in dev preview
    const sellHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const buyHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
    
    // Since we are mocking the dev page, window.location.origin is what the copy button uses.
    // However, the copy button creates the URL as: `${window.location.origin}/receipt/migrate/${sellHash}/${buyHash}`
    // But `ShareReceiptButton` might use `window.location.origin`. Wait! Is window.location.origin right? Playwright uses localhost:PORT.
    const url = await page.evaluate(() => window.location.origin);
    expect(copied).toBe(`${url}/receipt/migrate/${sellHash}/${buyHash}`);
  });
});
