import { test, expect } from "@playwright/test";
import { startVmServer, type VmServer } from "./vm-server";

test.describe("Migrate Receipt Permalink", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ reducedMotion: "reduce" });

  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3106,
      seed: "receipts",
      flags: {
        FEATURE_RECEIPTS: "1",
        FEATURE_SWITCH: "1",
        FEATURE_QUALITY: "1",
        FEATURE_STATEMENT: "1",
      },
    });
  });
  test.afterAll(() => server?.stop());

  const sellHash = "0xf111111111111111111111111111111111111111111111111111111111111111";
  const buyHash = "0xf122222222222222222222222222222222222222222222222222222222222222";

  for (const { w, h } of [
    { w: 375, h: 812 },
    { w: 768, h: 1024 },
    { w: 1280, h: 800 },
  ]) {
    test(`looks correct and has no horizontal scroll at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });

      await page.goto(`${server.url}/receipt/migrate/${sellHash}/${buyHash}`);

      // Check it renders correctly (the values from our bypass mock)
      await expect(page.getByText("10 NVDAB = 10 shares to 10 NVDAon = 10 shares")).toBeVisible();
      await expect(page.getByText("How they compare in shares:")).toBeVisible();

      // Ensure the share control is visible
      const copyBtn = page.getByRole("button", { name: "Copy Migrate Receipt Link" });
      await expect(copyBtn).toBeVisible();

      // Assert no horizontal scroll
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });
      expect(hasHorizontalScroll).toBe(false);
    });
  }

  test("dev page renders correctly", async ({ page }) => {
    await page.goto(`${server.url}/dev/migrate-receipt`);
    await expect(page.getByText("10 NVDAB = 10 shares to 10 NVDAon = 10 shares")).toBeVisible();
    await expect(page.getByText("How they compare in shares:")).toBeVisible();
  });

  test("share control copies the exact URL", async ({ page }) => {
    await page.goto(`${server.url}/receipt/migrate/${sellHash}/${buyHash}`);
    const copyBtn = page.getByRole("button", { name: "Copy Migrate Receipt Link" });
    await expect(copyBtn).toBeVisible();

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await copyBtn.click();

    // Check button state changed
    await expect(page.getByText("Link copied")).toBeVisible();

    // Read clipboard
    const handle = await page.evaluateHandle(() => navigator.clipboard.readText());
    const copied = await handle.jsonValue();

    expect(copied).toBe(`${server.url}/receipt/migrate/${sellHash}/${buyHash}`);
  });
});
