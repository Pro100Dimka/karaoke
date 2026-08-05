import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src");
const extensions = [".js", ".jsx", ".mjs", ".cjs"];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.join(base, `index${extension}`))
  ];
  return (
    candidates.find(
      (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ) ?? null
  );
}

const files = walk(srcRoot).filter((file) =>
  extensions.includes(path.extname(file))
);
const graph = new Map(files.map((file) => [file, []]));
const importPattern =
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const resolved = resolveImport(file, match[1]);
    if (resolved && graph.has(resolved)) graph.get(file).push(resolved);
  }
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycles = new Set();

function visit(file) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    const cycle = [...stack.slice(start), file].map((item) =>
      path.relative(root, item)
    );
    const rotations = cycle
      .slice(0, -1)
      .map((_, index, items) =>
        [...items.slice(index), ...items.slice(0, index)].join(" -> ")
      );
    cycles.add(rotations.sort()[0]);
    return;
  }
  if (visited.has(file)) return;

  visiting.add(file);
  stack.push(file);
  for (const dependency of graph.get(file) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(file);
  visited.add(file);
}

for (const file of files) visit(file);

if (cycles.size) {
  console.error(`Circular dependencies found: ${cycles.size}`);
  for (const cycle of cycles) console.error(`- ${cycle}`);
  process.exitCode = 1;
} else {
  console.log("No circular dependencies found.");
}
