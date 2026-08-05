import assert from "node:assert/strict";
import test from "node:test";
import {
  DIALOG_DEFAULTS,
  createDialogConfig,
  getDialogCloseResult,
  normalizeDialogOptions
} from "../src/contexts/dialog-utils.js";

for (const [kind, expected] of [
  ["confirm", false],
  ["alert", true],
  ["unknown", true],
  [null, true]
]) {
  test(`dialog close result for ${String(kind)}`, () => {
    assert.equal(getDialogCloseResult(kind), expected);
  });
}

for (const [value, expected] of [
  ["Заголовок", { title: "Заголовок" }],
  [null, {}],
  [undefined, {}],
  [5, {}],
  [[], {}],
  [{ title: "X" }, { title: "X" }]
]) {
  test(`normalize dialog options ${JSON.stringify(value)}`, () => {
    assert.deepEqual(normalizeDialogOptions(value), expected);
  });
}

test("confirm config uses confirmation defaults", () => {
  const config = createDialogConfig("confirm", "Удалить?");
  assert.equal(config.kind, "confirm");
  assert.equal(config.message, "Удалить?");
  assert.equal(config.cancelText, "Отмена");
});

test("unknown dialog kind safely falls back to alert", () => {
  const config = createDialogConfig("broken", null);
  assert.equal(config.kind, "alert");
  assert.equal(config.message, "");
  assert.equal(config.confirmText, "Понятно");
});

test("dialog options override defaults without mutating defaults", () => {
  const config = createDialogConfig("confirm", 42, {
    title: "Особый заголовок",
    confirmText: "Да"
  });
  assert.equal(config.message, "42");
  assert.equal(config.title, "Особый заголовок");
  assert.equal(config.confirmText, "Да");
  assert.equal(DIALOG_DEFAULTS.confirm.confirmText, "Подтвердить");
});

test("dialog defaults are immutable", () => {
  assert.equal(Object.isFrozen(DIALOG_DEFAULTS), true);
  assert.equal(Object.isFrozen(DIALOG_DEFAULTS.alert), true);
  assert.equal(Object.isFrozen(DIALOG_DEFAULTS.confirm), true);
});
