import { expect, test, type Page } from "@playwright/test";

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";

async function mockWallet(page: Page, signedIn = true) {
  await page.addInitScript(
    ([address, s]) => {
      (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
        address,
        signedIn: s,
      };
    },
    [USER, signedIn] as const,
  );
}

test.describe("round 3", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Radar uses Liquid / Low Liquidity / Not Tradable, and tags explain themselves on hover", async ({
    page,
  }) => {
    await page.goto("/radar");
    const stats = page.locator("dl").first();
    await expect(stats).toContainText("Liquid", { timeout: 20_000 });
    await expect(stats).toContainText("Low Liquidity");
    await expect(stats).toContainText("Not Tradable");
    await expect(page.getByText("Clean (A or B)")).toHaveCount(0);
    await expect(page.getByText("Flagged (C to F)")).toHaveCount(0);
    await expect(page.getByText("Ghost markets")).toHaveCount(0);
    const tag = page.getByTestId("radar-NVDAx").getByText("Not Tradable");
    await tag.hover();
    await expect(page.getByRole("tooltip")).toContainText("under $1,000");
  });

  test("the trade block says Min amount to receive and Slippage", async ({ page }) => {
    await page.goto("/trade/NVDA");
    const card = page.getByTestId("trade-card");
    await expect(card).toContainText("Min amount to receive", { timeout: 15_000 });
    await expect(card).toContainText("Slippage");
    await expect(card).not.toContainText("At least (guaranteed)");
    await expect(card).not.toContainText("Price can move up to");
  });

  test("Read more opens a blurred, translucent modal that ends in a link to How it works", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    await page.getByTestId("trade-card").getByRole("button", { name: "Read more" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("How the minimum is guaranteed");
    const blur = await page
      .locator(".overlay-backdrop")
      .evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(blur).toContain("blur");
    const link = dialog.getByRole("link", { name: "How it works" });
    await expect(link).toHaveAttribute("href", "/docs#how-guarantee");
    await link.click();
    await expect(page).toHaveURL(/\/docs#how-guarantee$/);
    await expect(page.locator("#how-guarantee")).toBeAttached();
  });

  test("Returning user line shows signed out and disappears once signed in", async ({ page }) => {
    await mockWallet(page, false);
    await page.goto("/");
    const line = page.getByTestId("hero-actions").getByTestId("returning-user");
    await expect(line).toContainText("Returning user? Sign in or Connect your wallet");
    await line.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("returning-user")).toHaveCount(0);
  });

  test("body text is medium weight and a size bigger than before", async ({ page }) => {
    await page.goto("/");
    const s = await page.evaluate(() => {
      const c = getComputedStyle(document.body);
      return { w: c.fontWeight, size: c.fontSize };
    });
    expect(s.w).toBe("500");
    expect(s.size).toBe("16px");
  });

  test("Select highlight glides between items instead of lighting each one", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-comparison").getByTestId("stock-picker").click();
    const list = page.locator('[role="listbox"][aria-hidden="false"]');
    const options = list.getByRole("option");
    await page.waitForTimeout(700); // the panel unfolds and its items stagger in
    await options.nth(1).hover();
    const pill = list.locator('[aria-hidden="true"].bg-muted');
    await expect(pill).toHaveCSS("opacity", "1");
    const y1 = (await pill.boundingBox())!.y;
    await options.nth(3).hover();
    await page.waitForTimeout(450);
    const y2 = (await pill.boundingBox())!.y;
    expect(y2).toBeGreaterThan(y1 + 20);
  });

  test("Send rejects bad addresses with a reason", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/");
    await page.getByTestId("account-button").click();
    await page.getByTestId("menu-send").click();
    const dialog = page.getByRole("dialog", { name: "Send from your wallet" });
    const to = dialog.getByTestId("send-to");
    await dialog.getByTestId("send-amount").fill("1");
    const cases: [string, string][] = [
      ["1111111111111111111111111111111111111111", "starts with 0x"],
      ["0x" + "z".repeat(40), "a-f"],
      ["0x0000000000000000000000000000000000000000", "zero address"],
      [USER, "your own address"],
    ];
    for (const [v, msg] of cases) {
      await to.fill(v);
      await expect(dialog.getByRole("alert")).toContainText(msg);
      await expect(dialog.getByTestId("send-review")).toBeDisabled();
    }
  });

  test("Portfolio shows the whole address with a Copy button", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mockWallet(page);
    await page.goto("/portfolio");
    await expect(page.getByTestId("full-address")).toHaveText(USER, { timeout: 20_000 });
    await page.getByTestId("copy-address").click();
    await expect(page.getByTestId("copy-address")).toContainText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(USER);
  });

  test("the account menu morphs open from the button without moving the nav or the page", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto("/");
    const btn = page.getByTestId("account-button");
    await expect(btn).toBeVisible();
    await page.waitForTimeout(500);
    const nav = page.getByRole("navigation", { name: "Primary" }).getByRole("link").first();
    const before = await nav.boundingBox();
    const btnBox = (await btn.boundingBox())!;
    await btn.click();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu.getByTestId("menu-send")).toBeVisible();
    await page.waitForTimeout(700);
    expect(await nav.boundingBox()).toEqual(before);
    // Grows downward from the button's own top edge, anchored to its right edge.
    const m = (await menu.boundingBox())!;
    expect(Math.abs(m.y - btnBox.y)).toBeLessThan(2);
    expect(Math.abs(m.x + m.width - (btnBox.x + btnBox.width))).toBeLessThan(2);
    expect(m.height).toBeGreaterThan(btnBox.height * 3);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await nav.boundingBox()).toEqual(before);
  });

  test("live numbers roll: the ticker keeps a readable value for screen readers", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    await expect(page.getByTestId("ref-price")).toContainText("$", { timeout: 15_000 });
    const sr = await page.getByTestId("ref-price").locator(".sr-only").textContent();
    expect(sr).toMatch(/^\$?[\d,]+\.\d\d$/);
  });
});
