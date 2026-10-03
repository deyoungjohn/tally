import { expect, test } from "@playwright/test";

test("production hides dev previews unless explicitly enabled", async ({ request }) => {
  test.skip(process.env.TALLY_FOUNDATION_E2E === "1", "This suite enables previews explicitly");
  expect((await request.get("/dev")).status()).toBe(404);
  expect((await request.get("/dev/foundation")).status()).toBe(404);
});

test.describe("foundation boundaries", () => {
  test.skip(
    process.env.TALLY_FOUNDATION_E2E !== "1",
    "Run pnpm e2e:foundation for the fixture/flag-enabled server",
  );

  for (const width of [375, 768, 1280]) {
    test(`client failure isolates one degraded card at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dev/foundation");
      await expect(page.getByRole("status", { name: "Flow degraded" })).toContainText(
        "Last good update:",
      );
      await expect(page.getByText("Statement remains available")).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(1);
      await expect(page.getByText("Quality flag is enabled")).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/foundation-${width}.png`, fullPage: true });
    });
  }
  test("all enabled navigation entries fit at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route("**/api/modules/health", (route) =>
      route.fulfill({
        json: {
          health: [],
          flags: { statement: true, flow: true, guardian: true, pies: true, quality: true },
        },
      }),
    );
    await page.goto("/dev");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const name of ["Portfolio", "Radar", "Guardian", "Pies", "Quality"])
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/foundation-all-nav.png", fullPage: true });
  });
  test("server loader failure isolates one degraded card under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dev/foundation?server=1");
    await expect(page.getByRole("status", { name: "Flow degraded" })).toBeVisible();
    await expect(page.getByText("Statement remains available")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(1);
    await page.screenshot({ path: "test-results/foundation-reduced-motion.png", fullPage: true });
  });
  test("fixture CLI writes snapshots whose collector health and public flags appear in the API", async ({
    request,
  }) => {
    const response = await request.get("/api/modules/health");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const data = await response.json();
    expect(data.health).toContainEqual(
      expect.objectContaining({
        module: "collect-registry",
        ok: true,
        lastOkAt: expect.any(Number),
      }),
    );
    expect(data.flags).toMatchObject({ flow: true, statement: true, quality: false });
    expect(Object.keys(data).sort()).toEqual(["flags", "health"]);
    expect(JSON.stringify(data)).not.toMatch(/BINANCE_W3_API|BSC_RPC|PRIVATE|SECRET/);
  });
  test("failed worker health and stale worker health each degrade only their own card", async ({
    page,
  }) => {
    await page.goto("/dev/foundation?health=1");
    await expect(page.getByRole("status", { name: "Guardian degraded" })).toContainText(
      "Last good update:",
    );
    await expect(page.getByText("Unhealthy module content")).toHaveCount(0);
    await expect(page.getByText("Statement remains available")).toBeVisible();
    await page.goto("/dev/foundation?stale=1");
    await expect(page.getByRole("status", { name: "Autopilot degraded" })).toBeVisible();
    await expect(page.getByText("Stale module content")).toHaveCount(0);
    await expect(page.getByText("Statement remains available")).toBeVisible();
  });
  test("navigation exposes only enabled module links and mobile menu still closes by keyboard", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/dev");
    const menu = page.getByRole("button", { name: "Open menu" });
    await expect(page.locator("header")).toBeVisible();
    await menu.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog.getByRole("link", { name: "Portfolio", exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Radar", exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Quality", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("link", { name: "Pies", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();
  });
});
