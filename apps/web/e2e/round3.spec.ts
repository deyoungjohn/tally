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

  test("Learn more opens a blurred, translucent modal that ends in a Tell me more link", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    await page.getByTestId("trade-card").getByRole("button", { name: "Learn more" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("How the minimum is guaranteed");
    const blur = await page
      .locator(".overlay-backdrop")
      .evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(blur).toContain("blur");
    const link = dialog.getByRole("link", { name: "Tell me more" });
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
    const pill = list.locator('span[aria-hidden="true"]').first();
    // Wherever the panel opens (up or down), the one pill must come to rest exactly on the hovered option.
    const onto = async (i: number) => {
      await options.nth(i).hover();
      await expect
        .poll(
          async () => {
            const p = await pill.boundingBox();
            const o = await options.nth(i).boundingBox();
            return p && o ? Math.abs(p.y - o.y) : 999;
          },
          { timeout: 5000 },
        )
        .toBeLessThan(3);
      return (await pill.boundingBox())!.y;
    };
    await expect(pill).toHaveCSS("opacity", "1");
    const y1 = await onto(1);
    const y2 = await onto(3);
    expect(Math.abs(y2 - y1)).toBeGreaterThan(20);
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
    ];
    for (const [v, msg] of cases) {
      await to.fill(v);
      await expect(dialog.getByRole("alert")).toContainText(msg);
      await expect(dialog.getByTestId("send-review")).toBeDisabled();
    }
    // Your own address is fine: it is how most people check that sending works.
    await to.fill(USER);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByTestId("send-review")).toBeEnabled();
  });

  test("Portfolio no longer repeats the wallet address", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/portfolio");
    await expect(page.getByTestId("total-value")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("copy-address")).toHaveCount(0);
    await expect(page.getByTestId("full-address")).toHaveCount(0);
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

  test("every Learn more link is caption sized", async ({ page }) => {
    await page.goto("/trade/NVDA");
    await expect(page.getByTestId("you-get")).toContainText("0.0", { timeout: 15_000 });
    const sizes = await page
      .locator(".learn-more")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).fontSize));
    expect(sizes.length).toBeGreaterThan(1); // the card and the issuer list
    for (const s of sizes) expect(s).toBe("13.5px");
    await expect(page.getByText("Read more")).toHaveCount(0);
  });

  test("Radar lists Liquid, then Low Liquidity, then Not Tradable, and has a morphing search", async ({
    page,
  }) => {
    await page.goto("/radar");
    await expect(page.getByTestId("radar-NVDAon")).toBeVisible({ timeout: 20_000 });
    const ranks = await page.locator('li[data-testid^="radar-"]').evaluateAll((els) =>
      els.map((el) => {
        const t = el.textContent ?? "";
        return t.includes("Not Tradable") && !el.querySelector(".badge-up")
          ? 2
          : t.includes("Low Liquidity")
            ? 1
            : t.includes("Not Tradable")
              ? 2
              : 0;
      }),
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    await page.getByRole("radio", { name: "Not Tradable" }).click();
    const only = await page.locator('li[data-testid^="radar-"]').count();
    expect(only).toBeGreaterThan(0);
    await page.getByRole("radio", { name: "All" }).click();

    await page.getByTestId("radar-search").click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await expect(dialog).toContainText("Suggestions");
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(380);
    await dialog.getByTestId("radar-search-input").fill("AAPL");
    await expect(dialog).toContainText("Results");
    await dialog.getByRole("option").first().click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("radar-NVDAon")).toHaveCount(0);
    await expect(page.locator('li[data-testid^="radar-AAPL"]').first()).toBeVisible();
  });

  test("the search surface keeps its cap on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/radar");
    await page.getByTestId("radar-search").click();
    const box = (await page.getByRole("dialog", { name: "Search" }).boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(375 - 24 + 1);
    expect(box.x).toBeGreaterThanOrEqual(11);
  });

  test("the nav highlight rests on the current page and glides to the hovered tab", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    const nav = page.getByRole("navigation", { name: "Primary" });
    const pill = nav.locator("span[aria-hidden]").first();
    await expect(pill).toHaveCSS("opacity", "1");
    const x0 = (await pill.boundingBox())!.x;
    const last = nav.getByRole("link").last();
    await last.hover();
    // The pill glides on a CSS transition. A fixed wait is flaky on a busy machine, so poll until it has
    // settled on the hovered tab; the thresholds are unchanged.
    await expect
      .poll(
        async () => {
          const p = (await pill.boundingBox())!;
          const l = (await last.boundingBox())!;
          return Math.abs(p.x - l.x);
        },
        { timeout: 5_000, intervals: [100, 200, 400] },
      )
      .toBeLessThan(2);
    const x1 = (await pill.boundingBox())!;
    expect(x1.x).toBeGreaterThan(x0 + 50);
    // The pill never starts from the top of the page: sample it moving back.
    await nav.getByRole("link").first().hover();
    for (let i = 0; i < 6; i++) {
      const b = (await pill.boundingBox())!;
      expect(b.y).toBeGreaterThan(10);
      expect(b.y).toBeLessThan(80);
      await page.waitForTimeout(40);
    }
  });

  test("on a phone the menu highlights the current page", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/radar");
    await page.getByRole("button", { name: "Open menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    const current = sheet.locator('a[aria-current="page"]');
    await expect(current).toHaveText("Radar");
    const pill = sheet.locator("ul span[aria-hidden]").first();
    await expect(pill).toHaveCSS("opacity", "1");
    // Poll for the highlight to settle instead of waiting a fixed time; the thresholds are unchanged.
    await expect
      .poll(
        async () => {
          const a = (await current.boundingBox())!;
          const b = (await pill.boundingBox())!;
          return Math.max(Math.abs(a.y - b.y), Math.abs(a.height - b.height));
        },
        { timeout: 5_000, intervals: [100, 200, 400] },
      )
      .toBeLessThan(3);
  });

  test("Home: the route line sits outside the box, below the button, with no 'via' or percentage", async ({
    page,
  }) => {
    await page.goto("/");
    const line = page.getByTestId("home-route");
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect(line).not.toContainText("via");
    await expect(line).not.toContainText("vs US");
    await expect(line).not.toContainText("%");
    await expect(page.getByTestId("home-get")).not.toContainText("per share");
    const l = (await line.boundingBox())!;
    const b = (await page.getByTestId("home-action").boundingBox())!;
    expect(l.y).toBeGreaterThan(b.y + b.height - 1);
    expect(l.y - (b.y + b.height)).toBeLessThan(40);
  });

  test("Live comparison says Updates in real-time", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-comparison")).toContainText("Updates in real-time", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("home-comparison")).not.toContainText("Refreshing");
  });

  test("Send lists every tokenized stock the wallet holds and sends one", async ({ page }) => {
    await mockWallet(page);
    await page.goto("/");
    await page.getByTestId("account-button").click();
    await page.getByTestId("menu-send").click();
    const dialog = page.getByRole("dialog", { name: "Send from your wallet" });
    await dialog.getByRole("radio", { name: "Tokenized stocks" }).click();
    const list = dialog.getByTestId("send-token-list");
    await expect(list.getByRole("radio", { name: /NVDAon/ })).toBeVisible({ timeout: 20_000 });
    await expect(list.getByRole("radio", { name: /NVDAB/ })).toBeVisible();
    await list.getByRole("radio", { name: /NVDAon/ }).click();
    await dialog.getByRole("button", { name: "Max" }).click();
    await expect(dialog.getByTestId("send-amount")).toHaveValue("0.025660879");
    await dialog.getByTestId("send-to").fill("0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930");
    await dialog.getByTestId("send-review").click();
    await expect(dialog).toContainText("NVDAon");
    await dialog.getByTestId("send-confirm").click();
    await expect(dialog.getByTestId("send-done")).toBeVisible({ timeout: 10_000 });
  });
});
