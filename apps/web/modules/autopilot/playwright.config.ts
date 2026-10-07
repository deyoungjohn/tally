import { defineConfig } from "@playwright/test";
import { join } from "node:path";
export default defineConfig({
  testDir: ".",
  testMatch: "preview.spec.ts",
  workers: 1,
  outputDir: "../../test-results/autopilot",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3118",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    cwd: join(__dirname, "../.."),
    command:
      "FEATURE_AUTOPILOT=1 TALLY_DEV_PREVIEWS=1 TALLY_ALLOW_MISSING_GEO=1 TALLY_FIXTURES=1 TALLY_DATA_DIR=/tmp/tally-wo08-preview PORT=3118 HOSTNAME=127.0.0.1 node .next/standalone/apps/web/server.js",
    url: "http://127.0.0.1:3118/dev/autopilot",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
