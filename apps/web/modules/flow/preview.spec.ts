import { expect, test } from "@playwright/test";
for (const width of [375, 768, 1280]) {
  for (const reduced of [false, true]) {
    test(`plain flow at ${width}px${reduced ? " with reduced motion" : ""}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await page.goto("/dev/flow");
      await expect(page.getByRole("heading", { name: "NVDAB: Grade A" })).toBeVisible();
      await expect(page.getByText("from chain logs", { exact: false }).first()).toBeVisible();
      await expect(
        page.getByText("price unavailable from chain logs", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText(/Stale \d+ min ago/).first()).toBeVisible();
      await expect(
        page
          .getByText("Top-trader labels unavailable; volume not cleaned", { exact: false })
          .first(),
      ).toBeVisible();
      const filename = `flow-${width}${reduced ? "-reduced" : ""}.png`;
      await page.screenshot({ path: testInfo.outputPath(filename), fullPage: true });
      await testInfo.attach(filename, {
        path: testInfo.outputPath(filename),
        contentType: "image/png",
      });
    });
  }
}
