export default {
  mutate: [
    "src/i18n/runtime.js",
    "src/i18n/translate.js",
    "src/utils/language.js",
    "src/utils/theme.js"
  ],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.mjs"
  },
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: { fileName: "reports/mutation/i18n.json" },
  thresholds: { high: 100, low: 100, break: 100 },
  cleanTempDir: true
};
