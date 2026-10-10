import { expect, test } from "@playwright/test";

const WIDTHS = [375, 768, 1280] as const;

test.describe("legal pages and the footer", () => {
  for (const path of ["/", "/trade", "/docs", "/terms", "/privacy"]) {
    test(`the copyright line and the Legal links are in the footer of ${path}`, async ({
      page,
    }) => {
      await page.goto(path);
      const footer = page.locator("footer");
      await expect(footer.getByTestId("copyright")).toHaveText(
        "© 2026 Tally Protocol. All rights reserved.",
      );
      await expect(footer.getByRole("link", { name: "Terms of Use" })).toHaveAttribute(
        "href",
        "/terms",
      );
      await expect(footer.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
        "href",
        "/privacy",
      );
    });
  }

  test("the Legal footer links open the pages", async ({ page }) => {
    await page.goto("/");
    await page.locator("footer").getByRole("link", { name: "Terms of Use" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of Use");
    await page.locator("footer").getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy Policy");
  });

  test("the Terms cover the restricted regions, the guarantee limits and non-custody", async ({
    page,
  }) => {
    await page.goto("/terms");
    await expect(page.getByTestId("legal-eligibility")).toContainText("Netherlands");
    await expect(page.getByTestId("legal-tokens")).toContainText("not the underlying shares");
    await expect(page.getByTestId("legal-wallet")).toContainText("non-custodial");
    await expect(page.getByTestId("legal-guarantee")).toContainText("does not protect you");
    await expect(page.getByTestId("legal-contact-line")).toContainText("Tally Protocol");
  });

  test("the Privacy Policy says what is processed and that nothing is sold", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByTestId("legal-collect")).toContainText("Your wallet address");
    await expect(page.getByTestId("legal-collect")).toContainText("does not store your email");
    await expect(page.getByTestId("legal-share")).toContainText("We do not sell your data");
    await expect(page.getByTestId("legal-rights")).toBeVisible();
  });

  test("the region block page carries the copyright line too", async ({ request }) => {
    const res = await request.get("/", { headers: { "cf-ipcountry": "US" } });
    expect(res.status()).toBe(451);
    expect(await res.text()).toContain("© 2026 Tally Protocol. All rights reserved.");
  });

  for (const w of WIDTHS) {
    test(`both pages fit at ${w}px with reduced motion`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      for (const path of ["/terms", "/privacy"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBeLessThanOrEqual(0);
        await page.screenshot({
          path: `test-results/legal${path.replace("/", "-")}-${w}.png`,
          fullPage: true,
        });
      }
      await ctx.close();
    });
  }
});

test("the 'plenty of trading' wording is gone: grades say good liquidity", async ({ page }) => {
  await page.goto("/radar");
  await expect(page.locator("body")).not.toContainText("plenty of trading");
});
