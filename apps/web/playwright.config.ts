import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: [["list"]],
  // PLAYWRIGHT_CHROMIUM_PATH lets sandboxes with a pre-installed Chromium run the suite; CI leaves it unset.
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: `TALLY_RATE_LIMIT_MULT=50 TALLY_FIXTURES=1 TALLY_ALLOW_MISSING_GEO=1 PORT=${PORT} node .next/standalone/apps/web/server.js`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
