import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const root = process.cwd();
const sourceRoot = resolve(root, "src");
const requestedFile = process.argv.find((argument) =>
  argument.startsWith("--file=")
);
const targetFile = requestedFile
  ? resolve(root, requestedFile.slice("--file=".length))
  : null;
const dryRun = process.argv.includes("--dry-run");
const sourceExtensions = new Set([".js", ".jsx", ".html"]);
const cssExtensions = new Set([".css"]);
const dynamicPrefixes = [
  "is-",
  "has-",
  "theme-",
  "status-",
  "badge-",
  "cosmic-",
  "karaoke-theme-",
  "karaoke-atmosphere-",
  "karaoke-flight-",
  "library-song-card--"
];

async function walk(directory, extensions) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return walk(path, extensions);
      return extensions.has(extname(entry.name)) ? [path] : [];
    })
  );
  return files.flat();
}

const sourceFiles = await walk(sourceRoot, sourceExtensions);
const cssFiles = await walk(sourceRoot, cssExtensions);
const applicationSource = (
  await Promise.all(sourceFiles.map((file) => readFile(file, "utf8")))
).join("\n");

const parsedFiles = await Promise.all(
  cssFiles.map(async (file) => ({
    file,
    root: postcss.parse(await readFile(file, "utf8"), { from: file })
  }))
);
const knownClasses = new Set();

for (const parsed of parsedFiles) {
  if (targetFile && resolve(parsed.file) !== targetFile) continue;
  parsed.root.walkRules((rule) => {
    selectorParser((selectors) => {
      selectors.walkClasses((node) => knownClasses.add(node.value));
    }).processSync(rule.selector);
  });
}

const unusedClasses = new Set(
  [...knownClasses].filter(
    (className) =>
      !applicationSource.includes(className) &&
      !dynamicPrefixes.some((prefix) => className.startsWith(prefix))
  )
);

let removedSelectors = 0;
let removedRules = 0;

for (const parsed of parsedFiles) {
  parsed.root.walkRules((rule) => {
    const selectors = selectorParser().astSync(rule.selector);
    const kept = selectors.nodes.filter((selector) => {
      let unused = false;
      selector.walkClasses((node) => {
        if (unusedClasses.has(node.value)) unused = true;
      });
      if (unused) removedSelectors += 1;
      return !unused;
    });

    if (!kept.length) {
      removedRules += 1;
      rule.remove();
      return;
    }

    rule.selector = kept.map((selector) => selector.toString()).join(",\n");
  });

  let removedEmptyContainer = true;
  while (removedEmptyContainer) {
    removedEmptyContainer = false;
    parsed.root.walkAtRules((atRule) => {
      if (Array.isArray(atRule.nodes) && atRule.nodes.length === 0) {
        atRule.remove();
        removedEmptyContainer = true;
      }
    });
  }

  if (!dryRun) await writeFile(parsed.file, parsed.root.toString(), "utf8");
}

console.log(`Unused CSS classes: ${unusedClasses.size}`);
console.log(`Removed selectors: ${removedSelectors}`);
console.log(`Removed rules: ${removedRules}`);
console.log(`Mode: ${dryRun ? "dry-run" : "write"}`);
for (const file of cssFiles.filter(
  (file) => !targetFile || resolve(file) === targetFile
)) {
  console.log(`Checked ${relative(root, file)}`);
}
