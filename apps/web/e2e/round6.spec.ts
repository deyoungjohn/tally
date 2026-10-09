import { expect, test, type Page } from "@playwright/test";

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";
const OTHER = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

async function mockWallet(page: Page) {
  await page.addInitScript((address) => {
    (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
      address,
      signedIn: true,
    };
  }, USER);
}
const flags = (page: Page, sell: boolean) =>
  page.route("**/api/modules/health", (route) =>
    route.fulfill({ json: { health: [], flags: { sell, receipts: false } } }),
  );

test.describe("round 6", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the flip button swaps buying and selling when selling is on", async ({ page }) => {
    await mockWallet(page);
    await flags(page, true);
    await page.goto("/trade/NVDA");
    const flip = page.getByTestId("flip-button");
    await expect(page.getByTestId("buy-button")).toBeVisible();
    await expect(flip).toBeEnabled();
    await flip.click();
    await expect(page.getByTestId("mode-label")).toContainText("Selling");
    await expect(page.getByTestId("sell-button")).toContainText("Sell NVDA");
    await expect(page.getByTestId("buy-button")).toHaveCount(0);
    await expect(page.getByTestId("trade-card")).not.toContainText("Slippage");
    await flip.click();
    await expect(page.getByTestId("buy-button")).toContainText(/Buy \$6\.00 of NVDA(on|B)/);
    await expect(page.getByTestId("mode-label")).toHaveCount(0);
  });

  test("with selling off the flip button is disabled and says why", async ({ page }) => {
    await mockWallet(page);
    await flags(page, false);
    await page.goto("/trade/NVDA");
    await expect(page.getByTestId("flip-button")).toBeDisabled();
    await expect(page.getByTestId("flip-button")).toHaveAttribute(
      "aria-label",
      "Selling is not switched on yet",
    );
  });

  test("sell mode: the slider fills the amount from the wallet's shares and the button opens the sell sheet", async ({
    page,
  }) => {
    await mockWallet(page);
    await flags(page, true);
    await page.route("**/api/trade/sell", (route) =>
      route.fulfill({
        status: 409,
        json: { error: { kind: "not_buyable", message: "No market." } },
      }),
    );
    await page.goto("/trade/NVDA");
    await page.getByTestId("flip-button").click();
    await expect(page.getByTestId("trade-slider-available")).toContainText("tokens", {
      timeout: 20_000,
    });
    await page.getByTestId("trade-slider-input").fill("100"); // the whole holding, about $6: above the $5 minimum sale
    await expect(page.locator("#amount")).not.toHaveValue("");
    await page.getByTestId("sell-button").click();
    await expect(page.getByRole("dialog", { name: /^Sell NVDA/ })).toBeVisible();
  });

  test("buy mode: the slider sets the dollar amount from the wallet's USDT", async ({ page }) => {
    await mockWallet(page);
    await flags(page, false);
    await page.goto("/trade/NVDA");
    await expect(page.getByTestId("trade-slider-available")).toContainText("USDT", {
      timeout: 20_000,
    });
    await page.getByTestId("trade-slider-input").fill("100");
    const v = Number(await page.locator("#amount").inputValue());
    expect(v).toBeGreaterThan(0);
  });

  test("Send: a slider, the shares held, and a warning built from the token, amount and address", async ({
    page,
  }) => {
    await mockWallet(page);
    await page.goto("/");
    await page.getByTestId("account-button").click();
    await page.getByTestId("menu-send").click();
    const dialog = page.getByRole("dialog", { name: "Send from your wallet" });
    await dialog.getByTestId("send-to").fill(OTHER);
    await dialog.getByTestId("send-slider-input").fill("100");
    await expect(dialog.getByTestId("send-amount")).not.toHaveValue("");
    await dialog.getByTestId("send-review").click();
    await expect(dialog).toContainText("accepts USDT on BNB Smart Chain (BEP-20)");
    await expect(dialog).toContainText(OTHER);
    await dialog.getByRole("button", { name: "Back" }).click();
    await dialog.getByRole("radio", { name: "Tokenized stocks" }).click();
    const token = dialog.getByTestId("send-token-NVDAB");
    await token.click({ timeout: 20_000 });
    await expect(dialog.getByTestId("send-balance")).toContainText("NVDAB");
    await expect(dialog.getByTestId("send-balance")).toContainText("shares)");
    await dialog.getByTestId("send-slider-input").fill("50");
    await dialog.getByTestId("send-review").click();
    await expect(dialog).toContainText("accepts NVDAB on BNB Smart Chain (BEP-20)");
  });

  test("the Select highlight sits under the hovered option once the list has opened", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    await page.getByTestId("stock-picker").click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await page.waitForTimeout(800); // the panel is inert while it unfolds, so a hover then would not be delivered
    const option = page.getByRole("option", { name: /^Tesla · / });
    await page.mouse.move(2, 2);
    await option.hover();
    await expect
      .poll(async () => {
        const o = await option.boundingBox();
        const pill = await list.locator("[data-glide-pill]").boundingBox();
        return o && pill ? Math.abs(o.y - pill.y) : 999;
      })
      .toBeLessThan(3);
  });

  test("the trade page columns scroll together on desktop (nothing is sticky)", async ({
    page,
  }) => {
    await page.goto("/trade/NVDA");
    await expect(page.getByTestId("trade-card")).toBeVisible();
    const pos = await page.getByTestId("trade-card").evaluate((el) => {
      let n: HTMLElement | null = el as HTMLElement;
      while (n) {
        if (getComputedStyle(n).position === "sticky") return "sticky";
        n = n.parentElement;
      }
      return "none";
    });
    expect(pos).toBe("none");
  });
});
