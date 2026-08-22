import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const ROOT = resolve("src");
const SOURCE_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"];
const IMPORT_PATTERN = /(?:from\s+|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g;

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name.endsWith("OLD")) return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function resolveImport(sourceFile, specifier) {
  const target = resolve(dirname(sourceFile), specifier);
  const candidates = [
    target,
    ...SOURCE_EXTENSIONS.map((extension) => `${target}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(target, `index${extension}`))
  ];
  return candidates.find(existsSync);
}

const errors = [];
for (const file of walk(ROOT).filter((path) => SOURCE_EXTENSIONS.includes(extname(path)))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    if (!resolveImport(file, match[2])) errors.push(`${file}: unresolved import ${match[2]}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log("All relative imports resolve correctly.");
