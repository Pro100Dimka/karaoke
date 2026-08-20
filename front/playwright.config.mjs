import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "../generated/tests/playwright",
  timeout: 30_000,
  globalSetup: "./tests/e2e/setup.mjs",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  }
});
