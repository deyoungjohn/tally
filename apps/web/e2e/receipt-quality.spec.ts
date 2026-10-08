import { expect, test } from "@playwright/test";
import { recordedHint } from "../../../packages/mod-receipts/src/fixtures/ingestion";
import { startVmServer, type VmServer } from "./vm-server";

/**
 * The receipt page (`/receipt/[txHash]`) and `/quality`, from the receipts and quality modules' view models. A real second
 * server (flags on, seeded throw-away data dir) proves the pages end to end, signed out; a third has flags on and no module
 * update (degraded); the default server (every flag off) proves both pages 404.
 */

const BUY_HASH = recordedHint("F11_NVDAB").txHash; // chain-verified, recorded comparison
const STALE_HASH = recordedHint("F11_NVDAon").txHash; // chain-verified, quote from the browser, observed long ago
const PENDING_HASH = `0x${"9e".repeat(32)}`; // known only from a browser hint
const UNKNOWN_HASH = `0x${"77".repeat(32)}`;
const GUARD = /0x28F6F19bffbF25E36452c78d12090F0bC922970a/i;

const geo = { "cf-ipcountry": "KR" };

test.describe("receipt and quality pages: real server, signed out", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 900 } });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3105,
      seed: "receipts",
      flags: { FEATURE_RECEIPTS: "1", FEATURE_QUALITY: "1", FEATURE_STATEMENT: "1" },
    });
  });
  test.afterAll(() => server?.stop());

  test("a verified buy shows Quoted, Simulated and Received, labelled fixture data, no contract address", async ({
    page,
  }) => {
    await page.goto(`${server.url}/receipt/${BUY_HASH}`);
    await expect(page.getByTestId("receipt-title")).toContainText("NVDAB purchase receipt", {
      timeout: 20_000,
    });
    // No registry snapshot is seeded, so the issuer is the browser's word and the page says so.
    await expect(page.getByTestId("receipt-issuer-note")).toContainText("reported by your browser");
    for (const s of ["Quoted", "Simulated", "Received"])
      await expect(page.getByTestId(`receipt-step-${s}`)).toBeVisible();
    await expect(page.getByTestId("receipt-status")).toBeVisible();
    await expect(page.getByTestId("vm-fixture-label")).toContainText("not live");
    await expect(page.getByTestId("receipt-browser-note")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /View on BscScan/ })).toHaveAttribute(
      "href",
      new RegExp(`bscscan.com/tx/${BUY_HASH}`),
    );
    expect(await page.locator("body").innerText()).not.toMatch(GUARD);
    expect(await page.content()).not.toMatch(GUARD);
  });

  test("a quote reported by the browser is labelled, and a stale receipt says how old it is", async ({
    page,
  }) => {
    await page.goto(`${server.url}/receipt/${STALE_HASH}`);
    await expect(page.getByTestId("receipt-title")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("receipt-browser-note")).toContainText(
      "Reported by your browser",
    );
    await expect(page.getByTestId("vm-stale")).toContainText("Last update");
  });

  test("a hint-only transaction is shown as pending with no claimed amounts", async ({ page }) => {
    await page.goto(`${server.url}/receipt/${PENDING_HASH}`);
    await expect(page.getByTestId("receipt-pending")).toContainText("pending", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("receipt-status")).toContainText("Pending");
    // Known only from a browser hint: no ladder and no amounts are claimed.
    await expect(page.getByTestId("receipt-step-Received")).toHaveCount(0);
  });

  test("an unknown hash is an honest empty page, a bad hash is refused in words", async ({
    page,
  }) => {
    await page.goto(`${server.url}/receipt/${UNKNOWN_HASH}`);
    await expect(page.getByTestId("vm-empty")).toContainText("No receipt yet", {
      timeout: 20_000,
    });
    await expect(page.getByRole("link", { name: /BscScan/ })).toBeVisible();
    await page.goto(`${server.url}/receipt/not-a-hash`);
    await expect(page.getByTestId("vm-empty")).toContainText("isn't a transaction hash", {
      timeout: 20_000,
    });
  });

  test("quality says when data is thin and shows the table", async ({ page }) => {
    await page.goto(`${server.url}/quality`);
    await expect(page.getByTestId("quality-table")).toBeVisible({ timeout: 20_000 });
    // The pending/excluded counts line is gone from the page.
    await expect(page.getByText("Pending attempts excluded")).toHaveCount(0);
    await expect(page.getByTestId("quality-insufficient")).toContainText("fewer than 5");
    await expect(page.getByTestId("vm-fixture-label")).toContainText("not live");
    expect(await page.locator("body").innerText()).not.toMatch(GUARD);
    // The table is beUI's Table and the page keeps itself current.
    await expect(page.getByTestId("quality-table")).toBeVisible();
    await expect(page.getByTestId("quality-live")).toContainText("Updates every 5s");
  });

  test("the quality page polls /api/vm/quality, which answers the module's view model", async ({
    page,
  }) => {
    const res = await page.request.get(`${server.url}/api/vm/quality`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.module).toBe("quality");
    expect(body.vm.state).toBe("ready");
    const polled = page.waitForRequest("**/api/vm/quality", { timeout: 20_000 });
    await page.goto(`${server.url}/quality`);
    await polled;
  });

  test("the Activity tab and the receipt modals link to the receipt page", async ({ page }) => {
    await page.addInitScript((a) => {
      (window as unknown as { __tallyMockWallet: unknown }).__tallyMockWallet = {
        address: a,
        signedIn: true,
      };
    }, recordedHint("F11_NVDAB").user);
    await page.route("**/api/modules/health", (route) =>
      route.fulfill({
        json: { health: [], flags: { statement: true, receipts: true, quality: true } },
      }),
    );
    await page.goto(`${server.url}/portfolio`);
    await page.getByRole("radio", { name: "Activity" }).click();
    const link = page.getByTestId(`activity-receipt-${BUY_HASH}`);
    await expect(link).toBeVisible({ timeout: 20_000 });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/receipt/${BUY_HASH}`));
    await expect(page.getByTestId("receipt-title")).toBeVisible({ timeout: 20_000 });
  });

  for (const w of [375, 768, 1280] as const) {
    test(`screenshots at ${w}px with reduced motion, no horizontal scroll`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      const shots: [string, string, string][] = [
        ["normal", `/receipt/${BUY_HASH}`, "receipt-title"],
        ["stale", `/receipt/${STALE_HASH}`, "vm-stale"],
        ["pending", `/receipt/${PENDING_HASH}`, "receipt-pending"],
        ["empty", `/receipt/${UNKNOWN_HASH}`, "vm-empty"],
        ["quality", "/quality", "quality-table"],
      ];
      for (const [name, path, id] of shots) {
        await page.goto(`${server.url}${path}`);
        await expect(page.getByTestId(id)).toBeVisible({ timeout: 20_000 });
        await page.screenshot({ path: `test-results/receipt-${name}-${w}.png`, fullPage: true });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBeLessThanOrEqual(0);
      }
      await ctx.close();
    });
  }

  test("the page answers when called without a wallet (share link)", async ({ request }) => {
    const res = await request.get(`${server.url}/receipt/${BUY_HASH}`, { headers: geo });
    expect(res.status()).toBe(200);
  });
});

test.describe("receipt and quality pages: module degraded", () => {
  test.use({ viewport: { width: 1280, height: 900 } });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3106,
      seed: "none",
      flags: { FEATURE_RECEIPTS: "1", FEATURE_QUALITY: "1" },
    });
  });
  test.afterAll(() => server?.stop());

  test("both pages show the catching-up card and claim nothing", async ({ page }) => {
    await page.goto(`${server.url}/receipt/${BUY_HASH}`);
    await expect(page.getByTestId("vm-degraded")).toContainText("Receipts is catching up", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("receipt-step-Received")).toHaveCount(0);
    await page.goto(`${server.url}/quality`);
    await expect(page.getByTestId("vm-degraded")).toContainText("Quality is catching up", {
      timeout: 20_000,
    });
  });
});

test.describe("receipt and quality pages: flags off", () => {
  test("both pages 404", async ({ request }) => {
    expect((await request.get(`/receipt/${BUY_HASH}`)).status()).toBe(404);
    expect((await request.get("/quality")).status()).toBe(404);
  });
});

test.describe("migrate permalink page: real server, signed out", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ viewport: { width: 1280, height: 900 } });
  let server: VmServer;
  test.beforeAll(async () => {
    server = await startVmServer({
      port: 3107, // new port
      seed: "receipts",
      flags: { FEATURE_RECEIPTS: "1", FEATURE_SWITCH: "1" },
    });
  });
  test.afterAll(() => server?.stop());

  test("a pair of random hashes renders 'not a Migrate' message", async ({ page }) => {
    const sellHash = "0x" + "1".repeat(64);
    const buyHash = "0x" + "2".repeat(64);
    await page.goto(`${server.url}/receipt/migrate/${sellHash}/${buyHash}`);
    await expect(page.locator("text=These two transactions are not a Migrate")).toBeVisible({
      timeout: 20_000,
    });
    const sellLink = page.getByRole("link", { name: "View Sale Receipt" });
    await expect(sellLink).toHaveAttribute("href", `/receipt/${sellHash}`);
    const buyLink = page.getByRole("link", { name: "View Buy Receipt" });
    await expect(buyLink).toHaveAttribute("href", `/receipt/${buyHash}`);
  });

  for (const w of [375, 768, 1280] as const) {
    test(`screenshots of 'not a migrate' at ${w}px with reduced motion`, async ({ browser }) => {
      const sellHash = "0x" + "1".repeat(64);
      const buyHash = "0x" + "2".repeat(64);
      const ctx = await browser.newContext({
        viewport: { width: w, height: 900 },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      await page.goto(`${server.url}/receipt/migrate/${sellHash}/${buyHash}`);
      await expect(page.locator("text=These two transactions are not a Migrate")).toBeVisible({
        timeout: 20_000,
      });
      await page.screenshot({
        path: `test-results/migrate-permalink-not-a-migrate-${w}.png`,
        fullPage: true,
      });
      await ctx.close();
    });
  }
});
