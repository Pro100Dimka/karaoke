import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeSettings,
  prepareSettingValue,
  resolveSavedSetting
} from "../src/hooks/settings-form-utils.js";

for (const [input, expected] of [
  [" value ", "value"],
  ["   ", ""],
  [5, 5],
  [false, false],
  [null, null],
  [undefined, undefined]
]) {
  test(`prepareSettingValue handles ${String(input)}`, () => {
    assert.equal(prepareSettingValue(input), expected);
  });
}

test("mergeSettings merges valid objects without mutating them", () => {
  const current = { theme: "dark", language: "ru" };
  const updated = { theme: "light" };
  const result = mergeSettings(current, updated);
  assert.deepEqual(result, { theme: "light", language: "ru" });
  assert.notEqual(result, current);
  assert.deepEqual(current, { theme: "dark", language: "ru" });
});

for (const invalid of [null, undefined, [], 4, "settings"]) {
  test(`mergeSettings tolerates invalid current ${String(invalid)}`, () => {
    assert.deepEqual(mergeSettings(invalid, { theme: "dark" }), {
      theme: "dark"
    });
  });
  test(`mergeSettings tolerates invalid update ${String(invalid)}`, () => {
    assert.deepEqual(mergeSettings({ theme: "dark" }, invalid), {
      theme: "dark"
    });
  });
}

test("resolveSavedSetting preserves explicit null and false", () => {
  assert.equal(resolveSavedSetting({ value: null }, "value", "fallback"), null);
  assert.equal(resolveSavedSetting({ value: false }, "value", true), false);
});

test("resolveSavedSetting falls back only when key is absent", () => {
  assert.equal(resolveSavedSetting({}, "value", "fallback"), "fallback");
  assert.equal(resolveSavedSetting(null, "value", "fallback"), "fallback");
});
