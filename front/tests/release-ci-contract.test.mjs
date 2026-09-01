import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";

const workflow = fs.readFileSync("../.github/workflows/release-gate.yml", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("release CI bootstraps a clean Windows checkout before verification", () => {
  for (const required of [
    "pull_request:",
    "actions/setup-python@v5",
    "python-version: 3.12.10",
    "cache-dependency-path: backend/requirements-lock.txt",
    "python -m venv backend/venv",
    "-r backend/requirements-lock.txt",
    "actions/setup-node@v4",
    "node-version: 22.18.0",
    "front/package-lock.json",
    "cloudflare/package-lock.json",
    "working-directory: front",
    "working-directory: cloudflare",
    "run: npm ci",
    "run: verify-release.bat",
    "actions/upload-artifact@v4",
    "generated/tests/security/*.json",
    "if-no-files-found: error",
    "generated/sbom/release.cdx.json"
  ])
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.ok(workflow.indexOf("python -m venv") < workflow.indexOf("run: verify-release.bat"));
  assert.equal((workflow.match(/run: npm ci/g) || []).length, 2);
});

test("frontend verify cannot bypass the OpenAPI contract audit", () => {
  assert.match(packageJson.scripts.verify, /npm run audit/);
  assert.match(packageJson.scripts.audit, /npm run audit:openapi-contract/);
});

test("frontend JavaScript is explicitly ESM while Electron entrypoints remain CommonJS", () => {
  assert.equal(packageJson.type, "module");
  assert.match(packageJson.main, /\.cjs$/);
});
