import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = [
  "src/styles/tokens.css",
  "src/styles/foundations.css",
  "src/styles/cascade/01-layer.css",
  "src/styles/cascade/02-layer.css",
  "src/styles/cascade/03-layer.css",
  "src/styles/cascade/04-layer.css",
  "src/styles/cascade/05-layer.css"
]
  .map(read)
  .join("\n");

const criticalSelectors = [
  ".song-recordings-backdrop",
  ".song-recordings-modal",
  ".processing-modal",
  ".performance-analysis-backdrop",
  ".performance-analysis-modal",
  ".settings-modal",
  ".song-settings-modal",
  ".library-page",
  ".library-card-deck",
  ".library-song-card",
  ".library-song-card-actions",
  ".karaoke-stage",
  ".karaoke-playback-controls",
  ".karaoke-lyrics",
  ".melody-roll",
  ".waveform-timeline",
  ".about-screen",
  ".about-logo",
  ".about-info",
  ".diagnostics-grid",
  ".diagnostics-check",
  ".diagnostics-error-item",
  ".table-empty",
  ".models-actions",
  ".settings-service-back"
];
for (const selector of criticalSelectors) {
  test(`critical visual selector exists: ${selector}`, () => {
    assert.equal(css.includes(selector), true);
  });
}

const criticalTokens = [
  "--color-text",
  "--color-surface",
  "--color-border",
  "--color-primary",
  "--text-primary",
  "--text-muted",
  "--accent-gradient",
  "--danger",
  "--success",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-5",
  "--space-6",
  "--space-8",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
  "--font-size-xs",
  "--font-size-sm",
  "--font-size-md",
  "--font-weight-semibold"
];
for (const token of criticalTokens) {
  test(`critical design token exists: ${token}`, () => {
    assert.match(css, new RegExp(`${token}\\s*:`));
  });
}

const modalSelectors = [
  ".song-recordings-modal",
  ".processing-modal",
  ".performance-analysis-modal",
  ".settings-modal",
  ".song-settings-modal"
];
for (const selector of modalSelectors) {
  test(`${selector} has a bounded viewport rule`, () => {
    const blocks = [
      ...css.matchAll(
        new RegExp(
          `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\{]*\\{([^}]*)\\}`,
          "g"
        )
      )
    ]
      .map((match) => match[1])
      .join("\n");
    assert.equal(/max-height|max-width|overflow/.test(blocks), true);
  });
}

const responsiveSelectors = [
  ".diagnostics-grid",
  ".library-card-deck",
  ".song-settings-workspace",
  ".settings-modal",
  ".performance-analysis-modal"
];
for (const selector of responsiveSelectors) {
  test(`${selector} participates in responsive CSS`, () => {
    const mediaIndex = css.indexOf("@media");
    assert.equal(
      mediaIndex >= 0 && css.slice(mediaIndex).includes(selector),
      true
    );
  });
}
