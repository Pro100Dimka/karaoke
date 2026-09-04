import assert from "node:assert/strict";
import fs from "node:fs";
import { test, vi } from "vitest";
import { translateSaved } from "../src/i18n/runtime.js";
import { messages } from "../src/i18n/messages.js";
import { interpolate, missingTranslationKeys, translate } from "../src/i18n/translate.js";
import { equal, deepEqual } from "./helpers/assertions.mjs";
const loadLanguage = async () => {
  vi.resetModules();
  return import("../src/utils/language.js");
};
const catalogs = {
  uk: {
    greeting: "Hello from Ukraine, {name}!",
    complete: "Ukrainian",
    ukFallback: "Ukrainian fallback"
  },
  ru: { greeting: "Hello from Russia, {name}!", complete: "Russian" },
  en: { greeting: "Hello, {name}!", complete: "English" }
};
test("UI locale source files do not contain duplicate translation keys", () => {
  for (const language of ["uk", "ru", "en"]) {
    const source = fs.readFileSync(new URL(`../src/i18n/messages-${language}.js`, import.meta.url), "utf8");
    const keys = [...source.matchAll(/^\s+"([^"]+)":/gm)].map(([, key]) => key);
    equal([new Set(keys).size, keys.length, `Duplicate translation key in messages-${language}.js`]);
  }
});
test("Ukrainian is the safe default locale", async () => {
  const { normalizeLanguage } = await loadLanguage();
  equal(
    [normalizeLanguage(), "uk"],
    [normalizeLanguage("uk"), "uk"],
    [normalizeLanguage("de"), "uk"],
    [normalizeLanguage("en"), "en"],
    [normalizeLanguage("ru"), "ru"]
  );
});
test("translation resolves locale, interpolation and fallbacks", () => {
  equal(
    [translate(catalogs, "en", "greeting", { name: "Ada" }), "Hello, Ada!"],
    [translate(catalogs, "de", "greeting", { name: "Olia" }), "Hello from Ukraine, Olia!"],
    [translate(catalogs, "en", "ukFallback"), "Ukrainian fallback"],
    [translate(catalogs, "en", "ukFallback", {}, "English source"), "Ukrainian fallback"],
    [translate(catalogs, "ru", "ukFallback", {}, "Russian source"), "Russian source"],
    [translate(catalogs, "en", "missing", {}, "Fallback"), "Fallback"],
    [translate(catalogs, "ru", "missing", {}, "Russian source"), "Russian source"],
    [translate(catalogs, "en", "missing"), "missing"],
    [interpolate("{known}/{unknown}", { known: 1 }), "1/{unknown}"]
  );
});
test("catalog parity reports every missing locale key", () => {
  deepEqual(
    [missingTranslationKeys({ uk: { one: "1", two: "2" }, en: { one: "1" } }), { uk: [], en: ["two"] }],
    [missingTranslationKeys({}), {}]
  );
});
test("saved locale handles available, absent and blocked storage", async () => {
  const { getSavedLanguage, saveLanguage } = await loadLanguage();
  const original = globalThis.localStorage;
  const values = new Map();
  const accessedKeys = [];
  globalThis.localStorage = {
    getItem: (key) => {
      accessedKeys.push(key);
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      accessedKeys.push(key);
      values.set(key, value);
    }
  };
  equal([getSavedLanguage(), "uk"], [saveLanguage("ru"), "ru"], [getSavedLanguage(), "ru"], [saveLanguage("invalid"), "uk"]);
  deepEqual([new Set(accessedKeys), new Set(["advoice-language"])]);
  delete globalThis.localStorage;
  equal([getSavedLanguage(), "uk"], [saveLanguage("en"), "en"]);
  globalThis.localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    }
  };
  equal([getSavedLanguage(), "uk"], [saveLanguage("en"), "en"]);
  globalThis.localStorage = original;
});
test("named catalogs have identical keys and preserve interpolation parameters", () => {
  const keys = Object.keys(messages.ru).sort();
  for (const language of ["uk", "en"]) deepEqual([keys, Object.keys(messages[language]).sort()]);
  assert.ok(keys.length > 350);
  for (const key of keys) {
    assert.match(key, /^[a-zA-Z][\w-]*(?:\.[\w-]+)+$/);
    const placeholders = messages.ru[key].match(/\{[A-Za-z0-9_]+\}/g)?.sort() ?? [];
    for (const language of ["uk", "en"]) {
      equal([typeof messages[language][key], "string"]);
      deepEqual([messages[language][key].match(/\{[A-Za-z0-9_]+\}/g)?.sort() ?? [], placeholders, `${language}: ${key}`]);
    }
  }
});
test("runtime resolves named keys using the persisted language", () => {
  const original = globalThis.localStorage;
  let language = "uk";
  globalThis.localStorage = { getItem: () => language };
  const key = "settings.appearance.online_name.label";
  equal([translateSaved(key), messages.uk[key]]);
  language = "en";
  equal([translateSaved(key), messages.en[key]]);
  language = "ru";
  equal([translateSaved(key), messages.ru[key]]);
  language = "uk";
  equal([translateSaved("room.person.speaking", { name: "X" }), "X говорить"]);
  globalThis.localStorage = original;
});
