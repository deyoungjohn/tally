import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../../e2e",
  testMatch: "module-boundary.spec.ts",
  fullyParallel: true,
  workers: 2,
  outputDir: "../../../test-results/foundation-run",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3101",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: "pnpm --filter @tally/worker exec tsx src/foundation-preview.ts",
    url: "http://127.0.0.1:3101/api/modules/health",
    timeout: 60_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
