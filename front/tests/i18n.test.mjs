import assert from "node:assert/strict";
import test from "node:test";

import { translateSaved } from "../src/i18n/runtime.js";
import sourceMessages from "../src/i18n/source-messages.json" with { type: "json" };
import {
  interpolate,
  missingTranslationKeys,
  translate
} from "../src/i18n/translate.js";
import {
  getSavedLanguage,
  normalizeLanguage,
  saveLanguage
} from "../src/utils/language.js";

const catalogs = {
  uk: {
    greeting: "Hello from Ukraine, {name}!",
    complete: "Ukrainian",
    ukFallback: "Ukrainian fallback"
  },
  ru: { greeting: "Hello from Russia, {name}!", complete: "Russian" },
  en: { greeting: "Hello, {name}!", complete: "English" }
};

test("Ukrainian is the safe default locale", () => {
  assert.equal(normalizeLanguage(), "uk");
  assert.equal(normalizeLanguage("uk"), "uk");
  assert.equal(normalizeLanguage("de"), "uk");
  assert.equal(normalizeLanguage("en"), "en");
});

test("translation resolves locale, interpolation and fallbacks", () => {
  assert.equal(
    translate(catalogs, "en", "greeting", { name: "Ada" }),
    "Hello, Ada!"
  );
  assert.equal(
    translate(catalogs, "de", "greeting", { name: "Olia" }),
    "Hello from Ukraine, Olia!"
  );
  assert.equal(translate(catalogs, "en", "ukFallback"), "Ukrainian fallback");
  assert.equal(
    translate(catalogs, "en", "ukFallback", {}, "English source"),
    "Ukrainian fallback"
  );
  assert.equal(
    translate(catalogs, "ru", "ukFallback", {}, "Russian source"),
    "Russian source"
  );
  assert.equal(
    translate(catalogs, "en", "missing", {}, "Fallback"),
    "Fallback"
  );
  assert.equal(
    translate(catalogs, "ru", "missing", {}, "Russian source"),
    "Russian source"
  );
  assert.equal(translate(catalogs, "en", "missing"), "missing");
  assert.equal(interpolate("{known}/{unknown}", { known: 1 }), "1/{unknown}");
});

test("catalog parity reports every missing locale key", () => {
  assert.deepEqual(
    missingTranslationKeys({ uk: { one: "1", two: "2" }, en: { one: "1" } }),
    { uk: [], en: ["two"] }
  );
  assert.deepEqual(missingTranslationKeys({}), {});
});

test("saved locale handles available, absent and blocked storage", () => {
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
  assert.equal(getSavedLanguage(), "uk");
  assert.equal(saveLanguage("ru"), "ru");
  assert.equal(getSavedLanguage(), "ru");
  assert.equal(saveLanguage("invalid"), "uk");
  assert.deepEqual(new Set(accessedKeys), new Set(["advoice-language"]));
  delete globalThis.localStorage;
  assert.equal(getSavedLanguage(), "uk");
  assert.equal(saveLanguage("en"), "en");
  globalThis.localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    }
  };
  assert.equal(getSavedLanguage(), "uk");
  assert.equal(saveLanguage("en"), "en");
  globalThis.localStorage = original;
});

test("generated source catalog is complete and preserves placeholders", () => {
  const ukrainianSources = Object.keys(sourceMessages.uk);
  assert.deepEqual(ukrainianSources, Object.keys(sourceMessages.en));
  assert.ok(ukrainianSources.length > 350);
  for (const source of ukrainianSources) {
    const placeholders = source.match(/\{[A-Za-z0-9_]+\}/g)?.sort() ?? [];
    for (const language of ["uk", "en"]) {
      assert.equal(typeof sourceMessages[language][source], "string");
      assert.deepEqual(
        sourceMessages[language][source].match(/\{[A-Za-z0-9_]+\}/g)?.sort() ??
          [],
        placeholders,
        `${language}: ${source}`
      );
    }
  }
});

test("runtime translates Russian sources using the persisted language", () => {
  const original = globalThis.localStorage;
  let language = "uk";
  globalThis.localStorage = { getItem: () => language };
  const source = "Библиотека песен";
  assert.equal(translateSaved(source), sourceMessages.uk[source]);
  language = "en";
  assert.equal(translateSaved(source), sourceMessages.en[source]);
  language = "ru";
  assert.equal(translateSaved(source), source);
  language = "uk";
  assert.equal(
    translateSaved("Неизвестно: {name}", { name: "X" }),
    "Неизвестно: X"
  );
  globalThis.localStorage = original;
});
