import { expect, test, type Page } from "@playwright/test";
import { startVmServer, type VmServer } from "./vm-server";
import fs from "node:fs";

const WALLET = "0x2Bf7EdF53bc6BE6FF98F149387F3818cE28d2930";

async function mockWallet(page: Page, address = WALLET) {
  await page.addInitScript((a) => {
    (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
      address: a,
      signedIn: true,
    };
  }, address);
}

test.describe("statement PDF export on seeded fixture server", () => {
  test.describe.configure({ mode: "serial" });
  let server: VmServer;

  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3105,
      seed: "full",
      flags: { FEATURE_STATEMENT: "1", FEATURE_RECEIPTS: "1", FEATURE_SELL: "1" },
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("clicking Download statement PDF triggers valid .pdf download and CSV still works", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await mockWallet(page);
    await page.goto(`${server.url}/portfolio`);

    // Switch to Statement tab
    await page.getByRole("radio", { name: "Statement" }).click({ timeout: 20_000 });
    await expect(page.getByTestId("st-table")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("st-pdf")).toBeVisible();
    await expect(page.getByTestId("st-csv")).toBeVisible();

    // 1. Download statement PDF
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("st-pdf").click(),
    ]);

    expect(pdfDownload.suggestedFilename()).toMatch(
      /^tally-statement-(0x2bf7ed|0x2Bf7Ed|0x2bf7)-\d{4}-\d{2}-\d{2}\.pdf$/i,
    );

    const pdfPath = await pdfDownload.path();
    expect(pdfPath).toBeTruthy();
    const pdfStat = fs.statSync(pdfPath!);
    expect(pdfStat.size).toBeGreaterThan(100);

    // 2. Download statement CSV still works
    const [csvDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("st-csv").click(),
    ]);

    expect(csvDownload.suggestedFilename()).toMatch(
      /^tally-statement-0x2bf7ed-\d{4}-\d{2}-\d{2}\.csv$/i,
    );
  });

  test("statement page has no horizontal scroll at 375px viewport", async ({ browser }) => {
    test.setTimeout(45_000);
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 667 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await mockWallet(page);
    await page.goto(`${server.url}/portfolio`);

    await page.getByRole("radio", { name: "Statement" }).click({ timeout: 20_000 });
    await expect(page.getByTestId("st-table")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("st-pdf")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await ctx.close();
  });
});
