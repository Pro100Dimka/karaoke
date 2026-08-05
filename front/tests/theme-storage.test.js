import assert from "node:assert/strict";
import test from "node:test";
import {
  readStoredTheme,
  resolveTheme,
  writeStoredTheme
} from "../src/utils/theme.js";

const invalidValues = [null, undefined, "", "   ", 0, false, {}, []];
for (const value of invalidValues) {
  test(`resolveTheme safely handles ${String(value)}`, () => {
    assert.equal(resolveTheme(value), "dark");
  });
}

for (const value of ["light", " dark ", "neon", "custom-theme"]) {
  test(`resolveTheme preserves valid theme ${value}`, () => {
    assert.equal(resolveTheme(value), value.trim());
  });
}

test("readStoredTheme reads from storage", () => {
  assert.equal(readStoredTheme({ getItem: () => "light" }), "light");
});

test("readStoredTheme survives unavailable storage", () => {
  assert.equal(readStoredTheme(null), "dark");
  assert.equal(
    readStoredTheme({
      getItem: () => {
        throw new Error("denied");
      }
    }),
    "dark"
  );
});

test("writeStoredTheme stores normalized value", () => {
  let saved;
  const result = writeStoredTheme(
    {
      setItem: (_key, value) => {
        saved = value;
      }
    },
    " light "
  );
  assert.equal(result, "light");
  assert.equal(saved, "light");
});

test("writeStoredTheme survives quota and privacy errors", () => {
  assert.equal(
    writeStoredTheme(
      {
        setItem: () => {
          throw new Error("quota");
        }
      },
      "light"
    ),
    "light"
  );
});
