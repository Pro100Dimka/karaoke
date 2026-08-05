import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("src");
const EXTENSIONS = new Set([".js", ".jsx"]);
const findings = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

for (const filePath of walk(ROOT)) {
  const source = fs.readFileSync(filePath, "utf8");
  const relative = path.relative(process.cwd(), filePath);
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    const isPromiseDelay = /setTimeout\s*\(resolve\s*,/.test(line);
    if (
      /setTimeout\s*\(/.test(line) &&
      !isPromiseDelay &&
      !/clearTimeout/.test(source)
    ) {
      findings.push(
        `${relative}:${index + 1} uses setTimeout without clearTimeout in the same file`
      );
    }
    if (/setInterval\s*\(/.test(line) && !/clearInterval/.test(source)) {
      findings.push(
        `${relative}:${index + 1} uses setInterval without clearInterval in the same file`
      );
    }
    if (
      /addEventListener\s*\(/.test(line) &&
      !/removeEventListener/.test(source)
    ) {
      findings.push(
        `${relative}:${index + 1} adds an event listener without removal in the same file`
      );
    }
  });
}

if (findings.length) {
  console.log("Potential React lifecycle findings:");
  findings.forEach((finding) => console.log(`- ${finding}`));
} else {
  console.log("No obvious timer or event-listener cleanup issues found.");
}
