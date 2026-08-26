#!/usr/bin/env node
// Given a list of changed files (argv, or one path per line on stdin --
// e.g. `git diff --name-only main... | node scripts/critical-tests-for-change.mjs`),
// prints which ownership zones (TASK 42.1) were touched and the critical
// test files/globs that should be run before merging.
import { zonesForChangedFiles } from "./ownership-map.mjs";

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const argvFiles = process.argv.slice(2);
const stdinText = argvFiles.length === 0 ? await readStdin() : "";
const changedFiles = (argvFiles.length > 0 ? argvFiles : stdinText.split("\n"))
  .map((line) => line.trim())
  .filter(Boolean);

if (changedFiles.length === 0) {
  console.error("No changed files given (pass as args, or pipe `git diff --name-only` into stdin).");
  process.exit(1);
}

const zones = zonesForChangedFiles(changedFiles);

if (zones.length === 0) {
  console.log("No high-review-priority zones touched.");
  process.exit(0);
}

console.log("Touched high-review-priority zones -- run their critical tests before merging:\n");
for (const zone of zones) {
  console.log(`${zone.name}:`);
  for (const test of zone.criticalTests) console.log(`  ${test}`);
}
