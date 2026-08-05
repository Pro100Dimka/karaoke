import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const karaokeRoot = path.join(root, "src/pages/Karaoke");
const stylesRoot = path.join(root, "src/styles");

function walk(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath, extension);
    return fullPath.endsWith(extension) ? [fullPath] : [];
  });
}

function readAllCss() {
  return walk(stylesRoot, ".css")
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function sourceClassNames() {
  const names = new Set();
  const stringPattern = /className\s*=\s*["'`]([^"'`]+)["'`]/g;

  for (const file of walk(karaokeRoot, ".jsx")) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(stringPattern)) {
      for (const name of match[1].split(/\s+/)) {
        if (/^[A-Za-z_][\w-]*$/.test(name)) names.add(name);
      }
    }
  }

  return [...names].sort();
}

test("karaoke CSS layer imports stay in cascade order", () => {
  const indexCss = fs.readFileSync(path.join(root, "src/index.css"), "utf8");
  const expected = [
    "./styles/tokens.css",
    "./styles/foundations.css",
    "./styles/cascade/01-layer.css",
    "./styles/cascade/02-layer.css",
    "./styles/cascade/03-layer.css",
    "./styles/cascade/04-layer.css",
    "./styles/cascade/05-layer.css",
    "./styles/refinements.css"
  ];
  const actual = [...indexCss.matchAll(/@import\s+["']([^"']+)["']/g)].map(
    (match) => match[1]
  );

  assert.deepEqual(actual, expected);
  for (const importPath of actual) {
    assert.equal(
      fs.existsSync(path.resolve(root, "src", importPath.replace("./", ""))),
      true,
      `missing CSS import ${importPath}`
    );
  }
});

test("every static Karaoke class has a CSS selector or a styled base class", () => {
  const css = readAllCss();
  const missing = sourceClassNames().filter((className) => {
    const exactSelector = new RegExp(`\\.${className}(?![\\w-])`);
    if (exactSelector.test(css)) return false;

    const modifierIndex = className.indexOf("--");
    if (modifierIndex > 0) {
      const baseClass = className.slice(0, modifierIndex);
      return !new RegExp(`\\.${baseClass}(?![\\w-])`).test(css);
    }

    return true;
  });

  assert.deepEqual(missing, []);
});

test("Karaoke JSX does not contain uncompiled arbitrary utility classes", () => {
  const invalid = [];
  for (const file of walk(karaokeRoot, ".jsx")) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/className\s*=\s*["']([^"']+)["']/g)) {
      for (const className of match[1].split(/\s+/)) {
        if (/\[|\]/.test(className)) {
          invalid.push(`${path.relative(root, file)}: ${className}`);
        }
      }
    }
  }

  assert.deepEqual(invalid, []);
});

test("critical Karaoke selectors and theme tokens remain available", () => {
  const css = readAllCss();
  const selectors = [
    "karaoke-lyrics",
    "karaoke-lyric-character",
    "waveform-timeline",
    "melody-roll",
    "melody-note-platform",
    "karaoke-settings-modal",
    "performance-analysis-modal",
    "microphone-level-fill"
  ];
  const tokens = [
    "--color-bg",
    "--color-surface",
    "--color-text",
    "--color-primary",
    "--space-6",
    "--radius-md",
    "--transition-fast"
  ];

  for (const selector of selectors) {
    assert.match(css, new RegExp(`\\.${selector}(?![\\w-])`));
  }
  for (const token of tokens) {
    assert.match(css, new RegExp(`${token}\\s*:`));
  }
});

test("all non-dynamic CSS custom properties are declared", () => {
  const css = readAllCss();
  const declared = new Set(
    [...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])
  );
  const used = new Set(
    [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1])
  );
  const dynamic = new Set([
    "--aurora-delay",
    "--aurora-depth",
    "--aurora-x",
    "--aurora-y",
    "--cosmic-delay",
    "--cosmic-size",
    "--cosmic-x",
    "--cosmic-y",
    "--j",
    "--karaoke-beat",
    "--karaoke-video-height",
    "--karaoke-video-width",
    "--n",
    "--panorama-image",
    "--panorama-x",
    "--panorama-y",
    "--particle-angle",
    "--particle-bottom",
    "--particle-color",
    "--particle-delay",
    "--particle-distance",
    "--particle-size",
    "--particle-x",
    "--scene-image",
    "--star-delay",
    "--star-x",
    "--star-y"
  ]);
  const missing = [...used].filter(
    (property) => !declared.has(property) && !dynamic.has(property)
  );

  assert.deepEqual(missing.sort(), []);
});
