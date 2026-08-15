import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "src");
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(file);
    return /\.(?:js|jsx|mjs)$/.test(entry.name) ? [file] : [];
  });
}
const files = [src, path.join(root, "tests")]
  .filter(fs.existsSync)
  .flatMap(walk);
const contents = new Map( files.map((file) => [file, fs.readFileSync(file, "utf8")])
);
const allSource = [...contents.values()].join("\n");
const candidates = [];
const exportPattern = /export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g;
for (const [file, content] of contents) {
  for (const match of content.matchAll(exportPattern)) {
    const name = match[1];
    const occurrences =
      allSource.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
    if (occurrences <= 1)
      candidates.push({ name, file: path.relative(root, file) });
  }
}
console.log(`Potential unused named exports: ${candidates.length}`);
for (const item of candidates) console.log(`- ${item.name} (${item.file})`);
console.log( "Review only; dynamic imports and re-exports are not removed automatically."
);
