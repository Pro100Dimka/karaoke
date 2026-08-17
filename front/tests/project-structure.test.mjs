import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const root = process.cwd();
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

test("keeps generated coverage consolidated under one canonical directory", () => {
  const legacyCoverage = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("coverage-"));
  expect(legacyCoverage).toEqual([]);
  expect(fs.readFileSync(path.join(root, "vitest.config.mjs"), "utf8")).toContain(
    'reportsDirectory: "coverage"'
  );

  if (exists("coverage")) {
    const reports = fs
      .readdirSync(path.join(root, "coverage"), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    expect(reports).not.toContain("coverage-final.json");
    expect(new Set(reports).size).toBe(reports.length);
  }
});

test("keeps required production entry files in their canonical locations", () => {
  expect(exists("src/components/Table.jsx")).toBe(true);
  expect(exists("src/runtime-config.js")).toBe(true);
  expect(exists("src/pages/Karaoke/performance-analysis-modal.jsx")).toBe(true);
  expect(exists("src/pages/MelodyEditor.jsx")).toBe(true);
});

test("release gate executes unit verification and pins a supported Node runtime", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const releaseCheck = fs.readFileSync(path.join(root, "scripts/check-release.mjs"), "utf8");
  expect(releaseCheck).toContain('["run", "verify"]');
  expect(pkg.scripts["build:electron"]).toContain("release:check");
  expect(pkg.engines?.node).toContain("22.18.0");
  expect(fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim()).toBe("22.18.0");
  expect(fs.readFileSync(path.join(root, ".node-version"), "utf8").trim()).toBe("22.18.0");
});


test("mutation gate uses canonical production module ids and pragmatic thresholds", () => {
  const stryker = fs.readFileSync(path.join(root, "stryker.config.mjs"), "utf8");
  expect(stryker).toContain("thresholds: { high: 90, low: 75, break: 75 }");
  expect(stryker).not.toContain('"src/pages/Settings/config.jsx"');
  expect(stryker).not.toContain('"src/pages/Settings/screens/**/config.js"');
  expect(stryker).toContain('"!src/utils/config.js"');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  expect(pkg.scripts["test:mutation"]).toBe(
    "stryker run && node scripts/check-mutation-quality.mjs"
  );
  const qualityCheck = fs.readFileSync(
    path.join(root, "scripts/check-mutation-quality.mjs"),
    "utf8"
  );
  expect(qualityCheck).toContain("const BREAK_SCORE = 75");
  expect(qualityCheck).toContain("const COVERED_TARGET = 90");

  const testFiles = fs
    .readdirSync(path.join(root, "tests"))
    .filter((name) => /\.(?:mjs|jsx)$/.test(name));
  const queryImports = [];
  for (const name of testFiles) {
    const source = fs.readFileSync(path.join(root, "tests", name), "utf8");
    if (/\.\.\/src\/[^\n"'`]+\?[^\n"'`]*/.test(source)) queryImports.push(name);
  }
  expect(queryImports).toEqual([]);
});
