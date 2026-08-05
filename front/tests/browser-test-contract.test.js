import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("mock mode is explicit and disabled in normal builds", () => {
  assert.equal(read(".env.mock").trim(), "VITE_USE_MOCK_API=true");
  const core = read("src/api/core.js");
  assert.match(core, /VITE_USE_MOCK_API === "true"/);
  assert.match(core, /if \(MOCK_API_ENABLED\) return mockRequest/);
});

test("mock scripts use a dedicated Vite mode", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["dev:mock"], /--mode mock/);
  assert.match(pkg.scripts["build:mock"], /--mode mock/);
  assert.match(pkg.scripts["preview:mock"], /--mode mock/);
});

test("Playwright smoke suite protects modal URLs and focus", () => {
  const source = read("e2e/app.spec.mjs");
  for (const contract of [
    "Настройки приложения",
    "Настройки песни",
    "toHaveURL(originalUrl)",
    "document.body.style.overflow",
    "node.contains(document.activeElement)",
    "expectViewportSafe(page)"
  ]) {
    assert.match(
      source,
      new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  }
});

test("visual scenario manifest has unique ids and valid viewports", () => {
  const scenarios = JSON.parse(read("e2e/visual-scenarios.json"));
  const ids = scenarios.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(scenarios.length >= 7);
  for (const scenario of scenarios) {
    assert.equal(typeof scenario.path, "string");
    assert.equal(typeof scenario.state, "string");
    assert.equal(scenario.viewport.length, 2);
    assert.ok(
      scenario.viewport.every((value) => Number.isInteger(value) && value > 0)
    );
  }
});

test("visual scenarios include compact and desktop Karaoke", () => {
  const scenarios = JSON.parse(read("e2e/visual-scenarios.json"));
  const ids = new Set(scenarios.map(({ id }) => id));
  assert.ok(ids.has("karaoke-desktop"));
  assert.ok(ids.has("karaoke-compact"));
  assert.ok(ids.has("settings-modal"));
  assert.ok(ids.has("song-settings-modal"));
});
