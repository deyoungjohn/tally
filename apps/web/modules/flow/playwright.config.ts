import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const web = join(__dirname, "../..");
const data = join(web, "test-results", "flow-preview-data");
export default defineConfig({
  testDir: ".",
  testMatch: "preview.spec.ts",
  workers: 1,
  outputDir: join(web, "test-results", "flow-preview"),
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3104",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command:
      "pnpm --filter @tally/worker exec tsx ../web/modules/flow/preview-fixture.ts && node .next/standalone/apps/web/server.js",
    cwd: web,
    port: 3104,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      TALLY_DATA_DIR: data,
      TALLY_FIXTURES: "1",
      TALLY_DEV_PREVIEWS: "1",
      TALLY_ALLOW_MISSING_GEO: "1",
      FEATURE_FLOW: "1",
      PORT: "3104",
      HOSTNAME: "127.0.0.1",
    },
  },
});
