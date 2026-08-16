import { readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const generated = new Set([
  ".pytest_cache",
  ".ruff_cache",
  ".runtime",
  ".stryker-tmp",
  "coverage",
  "dist",
  "reports",
  "test-results",
  "debug.log"
]);
for (const name of await readdir(root)) if (name.startsWith("coverage-")) generated.add(name);

await Promise.all(
  [...generated].map((target) => rm(resolve(root, target), { recursive: true, force: true }))
);

console.log(`Removed ${generated.size} generated paths.`);
