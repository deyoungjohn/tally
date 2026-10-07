import type { AutopilotVM } from "./view-model";
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

test("verified session loads a plain policy editor, saves decimal USD settings, and sends no transaction", async ({
  page,
}) => {
  const wallet = "0x0000000000000000000000000000000000000001";
  await page.addInitScript((address) => {
    window.__tallyMockWallet = { address: address as `0x${string}`, signedIn: true };
  }, wallet);
  const vm: AutopilotVM = {
    state: "ready",
    stale: false,
    ageMs: 0,
    source: "constructed API mock",
    reason: null,
    error: null,
    walletAddress: wallet,
    banner:
      "Binance's own daily limit is $1,000 and is only a backstop; these caps are enforced by Tally.",
    walletLimit: "Constructed API mock",
    mode: "shadow",
    armedRules: {},
    tokenAllowList: [],
    caps: { perTrade: "25", daily: "50", perTradeCeiling: "100", dailyCeiling: "250" },
    spentToday: "0",
    killSwitch: true,
    rows: [],
    policyEditable: true,
    policy: {
      armedRules: {},
      tokenAllowList: [],
      perTradeCap: "25",
      dailyCap: "50",
      killSwitch: true,
    },
    positions: [],
    collector: { state: "never collected", ageMs: null },
  };
  const stringify = (value: unknown) =>
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/session/autopilot/policy", async (route) => {
    expect(route.request().headers()["x-tally-wallet"]).toBe(wallet);
    expect(route.request().headers()["authorization"]).toBeTruthy();
    if (route.request().method() === "PUT") {
      saved = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        body: stringify({ walletAddress: wallet, policy: saved }),
      });
    } else
      await route.fulfill({
        contentType: "application/json",
        body: stringify({ walletAddress: wallet, viewModel: { ...vm, policyEditable: true } }),
      });
  });
  await page.goto("/dev/autopilot");
  await page.getByRole("button", { name: "Load verified shadow observations" }).click();
  const observations = page.getByRole("region", {
    name: "Verified-session shadow observations",
    exact: true,
  });
  const form = observations.getByRole("form", { name: "Shadow policy" });
  await expect(form.getByRole("button", { name: "Save shadow policy" })).toBeEnabled();
  await form.getByLabel("Per-trade cap", { exact: false }).fill("6");
  await form.getByRole("checkbox", { name: "Kill switch", exact: true }).check();
  await form.getByRole("button", { name: "Save shadow policy" }).click();
  await expect(form.getByRole("status")).toHaveText("Shadow policy saved. Nothing was executed.");
  expect(saved).toMatchObject({ perTradeCap: "6", dailyCap: "50", killSwitch: true });
  expect(saved).not.toHaveProperty("walletAddress");
  expect(
    await page.evaluate(
      () => (window as unknown as { __tallySentTxs?: unknown[] }).__tallySentTxs?.length ?? 0,
    ),
  ).toBe(0);
});
