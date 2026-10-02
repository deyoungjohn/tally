import { expect, test } from "@playwright/test";

// The web server runs with TALLY_ALLOW_MISSING_GEO=1, so only an explicit header decides.
test("US visitor gets the 451 block page", async ({ request }) => {
  const res = await request.get("/", { headers: { "cf-ipcountry": "US" } });
  expect(res.status()).toBe(451);
  expect(await res.text()).toContain("Not available in your region");
});

test("KR visitor sees the site", async ({ request }) => {
  const res = await request.get("/", { headers: { "cf-ipcountry": "KR" } });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("tokenized shares");
});

test("API is gated too", async ({ request }) => {
  const res = await request.get("/api/health", { headers: { "cf-ipcountry": "GB" } });
  expect(res.status()).toBe(451);
  expect((await res.json()).error).toBe("region_blocked");
});

test("Tor and unknown countries are blocked", async ({ request }) => {
  for (const code of ["T1", "XX"]) {
    const res = await request.get("/", { headers: { "cf-ipcountry": code } });
    expect(res.status(), code).toBe(451);
  }
});

test("block page renders in a browser at 375px with no scrolling", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 800 },
    extraHTTPHeaders: { "cf-ipcountry": "US" },
  });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Not available in your region" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  await ctx.close();
});
