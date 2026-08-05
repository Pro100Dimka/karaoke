import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const targets = [
  "dist",
  "release",
  "coverage",
  "reports",
  "test-results",
  "playwright-report",
  ".runtime",
  ".ruff_cache"
];

await Promise.all(
  targets.map((target) =>
    rm(resolve(process.cwd(), target), { recursive: true, force: true })
  )
);

console.log(`Removed ${targets.length} generated directories.`);
