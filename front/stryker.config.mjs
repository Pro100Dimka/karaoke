export default {
  mutate: [
    "src/i18n/runtime.js",
    "src/i18n/translate.js",
    "src/utils/language.js",
    "src/utils/theme.js"
  ],
  testRunner: "tap",
  tap: {
    testFiles: ["tests/i18n.test.mjs", "tests/theme.test.mjs"],
    nodeArgs: ["--experimental-default-type=module"],
    forceBail: true
  },
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/i18n.json" },
  thresholds: { high: 100, low: 100, break: 100 },
  cleanTempDir: true
};
