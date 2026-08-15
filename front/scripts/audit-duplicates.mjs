import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src");
const extensions = new Set([".js", ".jsx"]);
const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full === path.join(root, "theme")) continue;
      walk(full);
    }
    else if (extensions.has(path.extname(entry.name))) files.push(full);
  }
};
walk(root);

const windowSize = 6;
const occurrences = new Map();
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index <= lines.length - windowSize; index += 1) {
    const raw = lines.slice(index, index + windowSize);
    const normalized = raw.map((line) => line.trim()).join("\n");
    if (normalized.length < 100 || !/[A-Za-zА-Яа-я]/.test(normalized)) continue;
    const key = normalized.replace(/\s+/g, " ");
    const item = { file: path.relative(root, file), line: index + 1 };
    if (!occurrences.has(key)) occurrences.set(key, []);
    occurrences.get(key).push(item);
  }
}

const duplicates = [...occurrences.values()]
  .filter((items) => new Set(items.map(({ file }) => file)).size > 1)
  .sort((a, b) => b.length - a.length)
  .slice(0, 30);

if (!duplicates.length) {
  console.log("No repeated cross-file code windows found.");
  process.exit(0);
}
console.log(`Potential repeated code windows: ${duplicates.length}`);
for (const items of duplicates) {
  console.log(
    `- ${items.map(({ file, line }) => `${file}:${line}`).join(", ")}`
  );
}
