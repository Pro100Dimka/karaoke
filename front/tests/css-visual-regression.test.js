import assert from "node:assert/strict";
import test from "node:test";
import { readCssBundle } from "./helpers/css.js";

const css = readCssBundle([
  new URL("../src/styles/root.css", import.meta.url),
  new URL("../src/styles/theme.css", import.meta.url),
  new URL("../src/styles/app.css", import.meta.url)
]);

const criticalSelectors = [
  ".song-recordings-body",
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
  ".karaoke-transport-area",
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
  "--color-bg",
  "--color-text",
  "--color-text-muted",
  "--color-surface",
  "--color-border",
  "--color-primary",
  "--color-accent",
  "--color-danger",
  "--color-success",
  "--gradient-primary",
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
  "--font-size-md"
];
for (const token of criticalTokens) {
  test(`critical design token exists: ${token}`, () => {
    assert.match(css, new RegExp(`${token}\\s*:`));
  });
}

const modalSelectors = [
  ".song-recordings-body",
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
  ".library-card-deck",
  ".song-settings-workspace",
  ".settings-layout",
  ".settings-field"
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
