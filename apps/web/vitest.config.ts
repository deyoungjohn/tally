import { defineConfig } from "vitest/config";

// e2e/ belongs to Playwright.
export default defineConfig({
  test: { include: ["**/*.test.{ts,tsx}"], exclude: ["node_modules", "e2e", ".next"] },
});
