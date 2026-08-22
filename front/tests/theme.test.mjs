import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { equal } from "./helpers/assertions.mjs";
const loadTheme = async () => {
  vi.resetModules();
  return import("../src/utils/theme.js");
};
test("theme normalization accepts only supported themes", async () => {
  const { resolveTheme } = await loadTheme();
  equal(
    [resolveTheme("dark"), "dark"],
    [resolveTheme("light"), "light"],
    [resolveTheme("green"), "green"],
    [resolveTheme(" violet "), "violet"],
    [resolveTheme("unknown"), "dark"],
    [resolveTheme(null), "dark"],
    [resolveTheme({}), "dark"]
  );
});
test("theme storage is resilient and normalized", async () => {
  const { readStoredTheme, writeStoredTheme } = await loadTheme();
  const values = new Map([["karaoke-theme", "green"]]);
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value)
  };
  equal(
    [readStoredTheme(storage), "green"],
    [writeStoredTheme(storage, "light"), "light"],
    [values.get("karaoke-theme"), "light"],
    [readStoredTheme({ getItem: () => "invalid" }), "dark"],
    [readStoredTheme(), "dark"],
    [readStoredTheme({}), "dark"],
    [
      readStoredTheme({
        getItem: () => {
          throw new Error("blocked");
        }
      }),
      "dark"
    ],
    [writeStoredTheme(undefined, "green"), "green"],
    [writeStoredTheme({}, "green"), "green"],
    [
      writeStoredTheme(
        {
          setItem: () => {
            throw new Error("blocked");
          }
        },
        "green"
      ),
      "green"
    ]
  );
});
test("applying a theme synchronizes DOM, storage and Electron icon", async () => {
  const { applyTheme, getSavedTheme, saveTheme } = await loadTheme();
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
  equal(
    [saveTheme("violet"), "violet"],
    [getSavedTheme(), "violet"],
    [applyTheme("green"), "green"],
    [document.documentElement.dataset.theme, "green"]
  );
  assert.deepEqual(iconThemes, ["green"]);
  delete globalThis.window.electronAPI;
  equal([applyTheme("light"), "light"]);
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});
