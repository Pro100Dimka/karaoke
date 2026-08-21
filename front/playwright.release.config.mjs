import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/release-e2e",
  outputDir: "../generated/tests/playwright-release",
  // A cold Electron start can exceed 20 seconds while installer compression or
  // antivirus scanning is active. Assertions retain their tighter own limits.
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: { trace: "retain-on-failure" }
});
