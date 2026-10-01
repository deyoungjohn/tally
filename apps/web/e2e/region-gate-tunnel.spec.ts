import { expect, test } from "@playwright/test";

// Regression: behind a Cloudflare tunnel the request looks like https://localhost:3000. A rewrite to
// /blocked made Next proxy it over TLS to the plain-HTTP port (EPROTO, HTTP 500).
test("blocked visitor still gets 451 when the request arrives as a tunnel sends it", async ({
  request,
}) => {
  const res = await request.get("/", {
    headers: { host: "localhost:3000", "x-forwarded-proto": "https", "cf-ipcountry": "CA" },
  });
  expect(res.status()).toBe(451);
  expect(await res.text()).toContain("Not available in your region");
});

test("allowed visitor loads through the same tunnel-style request", async ({ request }) => {
  const res = await request.get("/", {
    headers: { host: "localhost:3000", "x-forwarded-proto": "https", "cf-ipcountry": "NG" },
  });
  expect(res.status()).toBe(200);
});
