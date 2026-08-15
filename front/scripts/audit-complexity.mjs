import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src");
const extensions = new Set([".js", ".jsx"]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === path.join(srcRoot, "theme")) return [];
      return walk(fullPath);
    }
    return [fullPath];
  });
}

const reports = [];
for (const file of walk(srcRoot).filter((item) =>
  extensions.has(path.extname(item))
)) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  const stateCount = (source.match(/\buseState\s*\(/g) ?? []).length;
  const effectCount = (source.match(/\buseEffect\s*\(/g) ?? []).length;
  const callbackCount = (source.match(/\buseCallback\s*\(/g) ?? []).length;
  const branchCount = (
    source.match(/\b(?:if|switch|case|catch)\b|&&|\?\?/g) ?? []
  ).length;

  if (
    lines.length > 500 ||
    stateCount > 15 ||
    effectCount > 12 ||
    branchCount > 80
  ) {
    reports.push({
      file: path.relative(root, file),
      lines: lines.length,
      stateCount,
      effectCount,
      callbackCount,
      branchCount
    });
  }
}

if (!reports.length) {
  console.log("No high-complexity files detected by the current thresholds.");
} else {
  console.log("Complexity review candidates (informational only):");
  for (const report of reports.sort((a, b) => b.lines - a.lines)) {
    console.log(
      `- ${report.file}: ${report.lines} lines, ${report.stateCount} useState, ` +
        `${report.effectCount} useEffect, ${report.callbackCount} useCallback, ` +
        `${report.branchCount} branch markers`
    );
  }
}
