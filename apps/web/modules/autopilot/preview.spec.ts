import { expect, test } from "@playwright/test";
for (const width of [375, 768, 1280]) {
  for (const reduced of [false, true]) {
    test(`constructed shadow preview at ${width}px${reduced ? " reduced motion" : ""}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await page.goto("/dev/autopilot");
      await expect(
        page.getByRole("heading", { name: "Autopilot preview — constructed data" }),
      ).toBeVisible();
      await expect(
        page.getByText(
          "Binance's own daily limit is $1,000 and is only a backstop; these caps are enforced by Tally.",
        ),
      ).toBeVisible();
      await expect(page.getByText(/would have sold; nothing was executed/)).toBeVisible();
      await expect(page.getByText("Spent today: $0", { exact: true })).toBeVisible();
      await expect(page.getByText("Stale snapshot: 600000 ms", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const filename = `autopilot-${width}${reduced ? "-reduced" : ""}.png`;
      await page.screenshot({ path: testInfo.outputPath(filename), fullPage: true });
      await testInfo.attach(filename, {
        path: testInfo.outputPath(filename),
        contentType: "image/png",
      });
    });
  }
}
