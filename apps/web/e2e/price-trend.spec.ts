import { expect, test } from "@playwright/test";

// The price line under the Home button: green when a fresh reading is above the last, red when below, white when equal.
test("Home price line: white first, green on an up tick, red on a down tick, white when unchanged", async ({
  page,
}) => {
  // The test sets the factor before each refresh, so extra quote requests at page load cannot shift the sequence.
  let factor = 1;
  await page.route("**/api/quote?*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const r of body.rows ?? []) if (typeof r.usdPerShare === "number") r.usdPerShare *= factor;
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/");
  const price = page.locator('[data-testid="home-route"] span.transition-colors').first();
  await expect(price).toBeVisible({ timeout: 20_000 });
  const color = () => price.evaluate((el) => getComputedStyle(el).color);
  const refresh = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(color, { timeout: 5_000 }).toBe("rgb(255, 255, 255)");
  factor = 1.02;
  await refresh();
  await expect.poll(color, { timeout: 5_000 }).toBe("rgb(61, 220, 151)");
  factor = 0.97;
  await refresh();
  await expect.poll(color, { timeout: 5_000 }).toBe("rgb(255, 107, 107)");
  await refresh();
  await expect.poll(color, { timeout: 5_000 }).toBe("rgb(255, 255, 255)");
});
