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
assert.equal(pkg.scripts["build:electron"], undefined, "Alternative Electron installer command exists");
assert.equal(pkg.build?.win?.target, "dir", "electron-builder must only create unpacked runtime");
assert.equal(pkg.build?.nsis, undefined, "NSIS must not compete with the Inno production installer");
assert.equal(pkg.build?.mac, undefined, "Unverified DMG release target must not be published");
assert.equal(pkg.build?.linux, undefined, "Unverified AppImage release target must not be published");
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
assert.match(installer, /electron-builder[\s\S]{0,120}--dir/);
assert.match(installer, /function Build-Installer[\s\S]*Inno Setup compilation failed/);
assert.match(batch, /scripts\\release_gate\.py/);
console.log("Release gate wiring audit passed.");
