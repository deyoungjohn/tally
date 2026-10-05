import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "receipts.spec.ts",
  workers: 1,
  reporter: "list",
  outputDir: "../../test-results/receipts-run",
  use: {
    baseURL: "http://localhost:3102",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    cwd: process.cwd(),
    command:
      "TALLY_DATA_DIR=/tmp/tally-wo02-preview TALLY_RECEIPT_PREVIEW=1 pnpm --filter @tally/worker exec tsx ../web/modules/receipts/seed.ts && TALLY_DATA_DIR=/tmp/tally-wo02-preview TALLY_DEV_PREVIEWS=1 TALLY_FIXTURES=1 TALLY_ALLOW_MISSING_GEO=1 FEATURE_RECEIPTS=1 FEATURE_QUALITY=1 PORT=3102 node .next/standalone/apps/web/server.js",
    port: 3102,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
