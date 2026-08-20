import os from "node:os";

const businessLogic = [
  "src/api/**/*.js",
  "src/contexts/**/*.{js,jsx}",
  "src/hooks/**/*.js",
  "src/i18n/**/*.{js,jsx}",
  "src/pages/**/hooks/**/*.js",
  "src/pages/**/utils.{js,jsx}",
  "src/pages/**/utils/**/*.{js,jsx}",
  "src/pages/Library/components/song-card/utils.js",
  "src/pages/Library/modals/song-settings/config.jsx",
  "src/pages/Library/modals/song-settings/melody-editor-*.js",
  "src/pages/Library/modals/song-settings/utils.js",
  "src/pages/Settings/audio-source.js",
  "src/pages/Settings/screens/**/format.js",
  "src/services/**/*.js",
  "src/utils/**/*.js"
];
const csv = (value) =>
  value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const selectedFiles = csv(process.env.MUTATION_FILES);
const selectedTests = csv(process.env.MUTATION_TEST_FILES);
const concurrency = Number(process.env.MUTATION_CONCURRENCY);

export default {
  mutate: selectedFiles?.length ? selectedFiles : businessLogic,
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.mjs",
    related: !selectedTests?.length
  },
  ...(selectedTests?.length ? { testFiles: selectedTests } : {}),
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "../generated/mutation/incremental.json",
  tempDirName: "../generated/mutation/temp",
  ignorePatterns: [
    ".runtime/**",
    ".stryker-tmp/**",
    "coverage/**",
    "dist/**",
    "release/**",
    "reports/**",
    "test-results/**"
  ],
  concurrency:
    Number.isInteger(concurrency) && concurrency > 0
      ? concurrency
      : selectedFiles?.length
        ? 4
        : Math.max(4, os.cpus().length - 2),
  reporters: ["progress", "clear-text", "json"],
  jsonReporter: {
    fileName:
      process.env.MUTATION_REPORT || "../generated/mutation/business-logic.json"
  },
  // Release blocks only on a genuinely weak suite; 90 remains the quality target.
  thresholds: { high: 90, low: 75, break: 75 },
  cleanTempDir: true
};
