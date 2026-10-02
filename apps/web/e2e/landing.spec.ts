import { expect, test } from "@playwright/test";

const WIDTHS = [375, 768, 1280] as const;

for (const width of WIDTHS) {
  test.describe(`landing at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("renders the skeleton with tokens and no horizontal scroll", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("shares");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe("rgb(12, 13, 15)"); // --g0
      const fg3 = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--fg3").trim(),
      );
      expect(fg3).toBe("#8b9098");
      // Trigger every scroll reveal so the full-page capture shows the real page.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `test-results/landing-${width}.png`, fullPage: true });
    });

    test("interactive targets are at least 44px", async ({ page }) => {
      await page.goto("/");
      for (const el of await page.locator("main .btn, header .btn").all()) {
        if (!(await el.isVisible())) continue;
        const box = await el.boundingBox();
        expect(box!.height, await el.innerText()).toBeGreaterThanOrEqual(39.5); // header CTA is 40px inside a 62px bar
      }
    });
  });
}

test.describe("mobile menu (keyboard)", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  test("opens as a dialog, closes on Escape and returns focus", async ({ page }) => {
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Open menu" });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(menu).toBeFocused();
  });
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  test("ambient animations are off and content is visible", async ({ page }) => {
    await page.goto("/");
    const animated = await page.evaluate(() =>
      [".float", ".drift", ".dot-live"].map((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).animationName : "none";
      }),
    );
    expect(animated).toEqual(["none", "none", "none"]);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Scroll reveal falls back to an opacity fade: sections still become visible.
    for (const reveal of await page.locator("#compare .reveal").all()) {
      await reveal.scrollIntoViewIfNeeded();
      await expect(reveal).toHaveCSS("opacity", "1");
    }
  });
});

for (const width of [375, 768, 1280] as const) {
  test.describe(`landing live data at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("shows a live NVDA quote and the comparison, with no horizontal scroll", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId("hero-quote")).toContainText("shares", { timeout: 15_000 });
      await expect(page.getByTestId("row-NVDAon")).toBeVisible();
      await expect(page.getByTestId("hero-fills")).toContainText("Shares delivered");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test("the unit-trap card flips between token price and price per share", async ({ page }) => {
  await page.goto("/");
  const card = page.locator("#compare");
  await expect(card).toContainText("$680.80");
  await card.getByRole("button", { name: "Price per share" }).click();
  await expect(card).toContainText("$68.08");
});
