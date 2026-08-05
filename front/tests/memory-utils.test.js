import assert from "node:assert/strict";
import test from "node:test";
import { formatBytes } from "../src/pages/Settings/screens/memory/format.js";

test("formatBytes handles byte counts and invalid input", () => {
  assert.equal(formatBytes(1024 ** 2), "1.0 МБ");
  assert.equal(formatBytes(0), "0.0 МБ");
  assert.equal(formatBytes(-1), "0.0 МБ");
  assert.equal(formatBytes("invalid"), "0.0 МБ");
});
