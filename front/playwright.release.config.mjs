import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/release-e2e",
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: { trace: "retain-on-failure" }
});
