import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const hash = "0xb678802dfb1dfa6e1206ac01fdf79d18181d5d61bab23d307b7ea059abc39a8e";
for (const width of [375, 768, 1280])
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`receipt and quality evidence at ${width}px, motion=${reducedMotion}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion });
      const directory = join(process.cwd(), "test-results/receipts/evidence");
      mkdirSync(directory, { recursive: true });
      await page.goto(`/dev/receipts?txHash=${hash}`);
      await expect(page.getByRole("region", { name: "Receipt", exact: true })).toBeVisible();
      await expect(page.getByText("RECONCILED", { exact: true })).toBeVisible();
      await expect(page.getByText("Signed minimum:", { exact: false })).toBeVisible();
      await page.getByText("Evidence", { exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Block: 125272679")).toBeVisible();
      await page.screenshot({
        path: join(directory, `receipt-${width}-${reducedMotion}.png`),
        fullPage: true,
      });
      await expect(page).toHaveURL(new RegExp(hash));
      await page.goto("/dev/receipts");
      await expect(page.getByRole("region", { name: "Activity" })).toBeVisible();
      await page.goto("/dev/quality");
      await expect(page.getByRole("region", { name: "Quality" })).toBeVisible();
      await expect(
        page.getByText("Insufficient data: fewer than 5 fills with verified comparisons.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText("0 pending attempts excluded", { exact: false })).toBeVisible();
      await expect(page.getByText("bstock", { exact: true })).toBeVisible();
      await expect(page.getByText("ondo", { exact: true })).toBeVisible();
      await page.screenshot({
        path: join(directory, `quality-${width}-${reducedMotion}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }
test("HTTP ingestion rejects GET and foreign origins", async ({ request }) => {
  expect((await request.get("/api/receipts")).status()).toBe(405);
  expect(
    (
      await request.post("/api/receipts", { headers: { origin: "https://foreign.test" }, data: {} })
    ).status(),
  ).toBe(403);
});
