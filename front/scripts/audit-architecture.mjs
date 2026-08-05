import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
}
walk(sourceRoot);

const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const read = (file) => fs.readFileSync(file, "utf8");
const violations = [];
const advisories = [];

function forbid(label, pattern, allow = new Set()) {
  for (const file of files) {
    const name = relative(file);
    if (allow.has(name)) continue;
    if (pattern.test(read(file))) violations.push(`${label}: ${name}`);
  }
}

forbid("destructured catch parameter", /catch\s*\(\s*\{/);
forbid(
  "direct localStorage access",
  /(?:window\.|globalThis\.)?localStorage/,
  new Set(["src/utils/theme.js", "src/pages/Karaoke/utils/preferences.js"])
);
forbid(
  "direct interpolation of unknown error.message",
  /\$\{\s*(?:err|error)\.message\s*\}/
);
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
} else {
  console.log("Architecture policies: passed.");
}

if (advisories.length) {
  console.log("Large-file advisories:");
  advisories.forEach((advisory) => console.log(`- ${advisory}`));
}
