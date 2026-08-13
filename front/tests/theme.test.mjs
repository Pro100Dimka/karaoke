import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTheme,
  getSavedTheme,
  readStoredTheme,
  resolveTheme,
  saveTheme,
  writeStoredTheme
} from "../src/utils/theme.js";

test("theme normalization accepts only supported themes", () => {
  assert.equal(resolveTheme("dark"), "dark");
  assert.equal(resolveTheme(" violet "), "violet");
  assert.equal(resolveTheme("unknown"), "dark");
  assert.equal(resolveTheme(null), "dark");
  assert.equal(resolveTheme({}), "dark");
});

test("theme storage is resilient and normalized", () => {
  const values = new Map([["karaoke-theme", "green"]]);
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value)
  };
  assert.equal(readStoredTheme(storage), "green");
  assert.equal(writeStoredTheme(storage, "light"), "light");
  assert.equal(values.get("karaoke-theme"), "light");
  assert.equal(readStoredTheme({ getItem: () => "invalid" }), "dark");
  assert.equal(readStoredTheme(), "dark");
  assert.equal(readStoredTheme({}), "dark");
  assert.equal(
    readStoredTheme({
      getItem: () => {
        throw new Error("blocked");
      }
    }),
    "dark"
  );
  assert.equal(writeStoredTheme(undefined, "green"), "green");
  assert.equal(writeStoredTheme({}, "green"), "green");
  assert.equal(
    writeStoredTheme(
      {
        setItem: () => {
          throw new Error("blocked");
        }
      },
      "green"
    ),
    "green"
  );
});

test("applying a theme synchronizes DOM, storage and Electron icon", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const values = new Map();
  const iconThemes = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value)
    },
    electronAPI: { setIconTheme: (theme) => iconThemes.push(theme) }
  };
  globalThis.document = { documentElement: { dataset: {} } };

  assert.equal(saveTheme("violet"), "violet");
  assert.equal(getSavedTheme(), "violet");
  assert.equal(applyTheme("green"), "green");
  assert.equal(document.documentElement.dataset.theme, "green");
  assert.deepEqual(iconThemes, ["green"]);

  delete globalThis.window.electronAPI;
  assert.equal(applyTheme("light"), "light");

  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});
