import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "preview.spec.ts",
  workers: 1,
  outputDir: "../../test-results/pies",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3109",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command:
      "FEATURE_PIES=1 TALLY_DEV_PREVIEWS=1 TALLY_ALLOW_MISSING_GEO=1 TALLY_FIXTURES=1 TALLY_DATA_DIR=/tmp/tally-wo09-preview PORT=3109 HOSTNAME=127.0.0.1 node .next/standalone/apps/web/server.js",
    url: "http://127.0.0.1:3109/dev/pies",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
