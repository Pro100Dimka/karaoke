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

test("keeps leaf source directories meaningful instead of wrapping one file", () => {
  const singletonDirectories = [];
  const sourceRoot = path.join(root, "src");
  const themeRoot = path.join(sourceRoot, "theme");
  const singletonAuditRoots = new Set([sourceRoot, themeRoot]);
  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    const childDirectories = entries.filter((entry) => entry.isDirectory());
    const childFiles = entries.filter((entry) => entry.isFile());
    if (
      !singletonAuditRoots.has(directory) &&
      childDirectories.length === 0 &&
      childFiles.length === 1
    ) {
      singletonDirectories.push(path.relative(root, directory));
    }
    for (const entry of childDirectories) {
      const child = path.join(directory, entry.name);
      if (child !== themeRoot) walk(child);
    }
  };
  walk(sourceRoot);

  expect(singletonDirectories).toEqual([]);
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
