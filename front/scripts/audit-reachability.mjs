import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const sourceRoot = path.join(projectRoot, "src");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".css"]);
const entryFiles = ["main.jsx", "index.css"].map((name) =>
  path.join(sourceRoot, name)
);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolutePath) : [absolutePath];
  });
}

const sourceFiles = new Set(
  walk(sourceRoot)
    .filter(
      (filePath) =>
        sourceExtensions.has(path.extname(filePath)) &&
        !path.relative(sourceRoot, filePath).startsWith(`theme${path.sep}`)
    )
    .map((filePath) => path.normalize(filePath))
);

function resolveImport(importerPath, specifier) {
  if (!specifier.startsWith(".")) return null;

  const basePath = path.resolve(path.dirname(importerPath), specifier);
  const candidates = [
    basePath,
    ...[".js", ".jsx", ".ts", ".tsx", ".css"].map(
      (extension) => `${basePath}${extension}`
    ),
    ...["index.js", "index.jsx", "index.ts", "index.tsx", "index.css"].map(
      (name) => path.join(basePath, name)
    )
  ];

  return (
    candidates
      .map(path.normalize)
      .find((candidate) => sourceFiles.has(candidate)) || null
  );
}

function collectSpecifiers(source, extension) {
  const specifiers = [];
  const javascriptImportPattern =
    /(?:import\s+(?:[^"']*?\s+from\s+)?|export\s+[^"']*?\s+from\s+|import\s*\()\s*["']([^"']+)["']/g;
  const cssImportPattern = /@import\s+(?:url\()?\s*["']([^"']+)["']/g;

  for (const match of source.matchAll(javascriptImportPattern)) {
    specifiers.push(match[1]);
  }
  if (extension === ".css") {
    for (const match of source.matchAll(cssImportPattern)) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

const reachable = new Set();
const pending = entryFiles.map(path.normalize);

while (pending.length) {
  const currentPath = pending.pop();
  if (
    !currentPath ||
    reachable.has(currentPath) ||
    !sourceFiles.has(currentPath)
  ) {
    continue;
  }

  reachable.add(currentPath);
  const source = fs.readFileSync(currentPath, "utf8");
  const extension = path.extname(currentPath);

  for (const specifier of collectSpecifiers(source, extension)) {
    const dependency = resolveImport(currentPath, specifier);
    if (dependency && !reachable.has(dependency)) pending.push(dependency);
  }
}

const unreachable = [...sourceFiles]
  .filter((filePath) => !reachable.has(filePath))
  .map((filePath) => path.relative(projectRoot, filePath))
  .sort();

if (unreachable.length) {
  console.error("Unreachable production source files:");
  unreachable.forEach((filePath) => console.error(`- ${filePath}`));
  process.exitCode = 1;
} else {
  console.log(
    `All ${reachable.size} production source files are reachable from application entries.`
  );
}
