import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const front = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(front, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(front, "package.json"), "utf8"));
const releaseGate = fs.readFileSync(path.join(root, "scripts", "release_gate.py"), "utf8");
const installer = fs.readFileSync(path.join(root, "scripts", "build-installer.ps1"), "utf8");
const batch = fs.readFileSync(path.join(root, "verify-release.bat"), "utf8");

assert.equal(
  pkg.scripts["test:e2e:electron-release"],
  "playwright test -c playwright.release.config.mjs"
);
assert.equal(pkg.scripts["verify:release"], "python ../scripts/release_gate.py");
for (const required of [
  "Backend full suite + coverage",
  "Frontend verify",
  "Frontend mutation gate",
  "Browser user-journey E2E",
  "Electron release-critical E2E",
  "front/node_modules is missing",
  "Tests were NOT run"
])
  assert.ok(releaseGate.includes(required), `release_gate.py lost mandatory step: ${required}`);
assert.match(
  installer,
  /if \(-not \$Worker\)[\s\S]*verify-release\.bat[\s\S]*Release gate failed\. Installer build is blocked\./
);
assert.match(batch, /scripts\\release_gate\.py/);
console.log("Release gate wiring audit passed.");
