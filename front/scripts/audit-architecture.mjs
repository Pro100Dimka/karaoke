import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const files = [];
const SOURCE_FILE_PATTERN = /\.(?:js|jsx|ts|tsx|css)$/;
const SINGLETON_AUDIT_EXCLUSIONS = [sourceRoot, path.join(sourceRoot, "theme")];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === path.join(sourceRoot, "theme")) continue;
      walk(fullPath);
    } else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
}
walk(sourceRoot);

const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const read = (file) => fs.readFileSync(file, "utf8");
const violations = [];
const advisories = [];

function auditSingletonDirectories(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const childDirectories = entries.filter((entry) => entry.isDirectory());
  const childFiles = entries.filter(
    (entry) => entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)
  );
  if (!SINGLETON_AUDIT_EXCLUSIONS.includes(directory)) {
    if (childDirectories.length === 0 && childFiles.length === 1) {
      violations.push(`single-file source directory must be flattened: ${relative(directory)}`);
    }
  }
  for (const entry of childDirectories) {
    const child = path.join(directory, entry.name);
    if (child === path.join(sourceRoot, "theme")) continue;
    auditSingletonDirectories(child);
  }
}
auditSingletonDirectories(sourceRoot);

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith("coverage-"))
    violations.push(`legacy coverage directory must be consolidated: ${entry.name}`);
}
const coverageRoot = path.join(root, "coverage");
if (fs.existsSync(coverageRoot)) {
  for (const entry of fs.readdirSync(coverageRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "coverage-final.json")
      violations.push("coverage/coverage-final.json must use a descriptive report name");
  }
}

function forbid(label, pattern, allow = []) {
  for (const file of files) {
    const name = relative(file);
    if (allow.includes(name)) continue;
    if (pattern.test(read(file))) violations.push(`${label}: ${name}`);
  }
}

forbid("destructured catch parameter", /catch\s*\(\s*\{/);
forbid("direct localStorage access", /(?:window\.|globalThis\.)?localStorage/, [
  "src/utils/theme.js",
  "src/utils/language.js",
  "src/utils/storage.js",
  "src/pages/Karaoke/utils/preferences.js"
]);
forbid("direct interpolation of unknown error.message", /\$\{\s*(?:err|error)\.message\s*\}/);
forbid("javascript URL", /(?:href|src)\s*=\s*["']javascript:/i);
forbid("placeholder hash link", /href\s*=\s*["']#["']/i);

const routes = read(path.join(sourceRoot, "components/routes.jsx"));
if (/key=\{(?:index|i)\}/.test(routes) || !routes.includes("key={path}")) {
  violations.push("routes must use stable path keys");
}

for (const file of files) {
  const name = relative(file);
  const lines = read(file).split(/\r?\n/).length;
  if (lines > 700) advisories.push(`${name}: ${lines} lines`);
}

if (violations.length) {
  console.error("Architecture policy violations:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
} else console.log("Architecture policies: passed.");

if (advisories.length) {
  console.log("Large-file advisories:");
  advisories.forEach((advisory) => console.log(`- ${advisory}`));
}
