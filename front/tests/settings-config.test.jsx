import { readFileSync, existsSync } from "node:fs";
import { expect, test } from "vitest";
import { SERVICES, TABS } from "../src/pages/Settings/schema";
import appearanceRows from "../src/pages/Settings/appearance-rows";
import audioRows from "../src/pages/Settings/audio-rows";
import processingRows from "../src/pages/Settings/processing-rows";

test("Settings uses direct Formik rows and has no old form adapters", () => {
  const source = readFileSync(new URL("../src/pages/Settings/index.jsx", import.meta.url), "utf8");
  expect(source).toContain("<RenderFormikFields");
  expect(source).toContain("useGetForm(");
  for (const file of ["SettingsForm.jsx", "bindings.js", "use-settings-form.js", "MonitorDiagnostics.jsx"]) {
    expect(existsSync(new URL(`../src/pages/Settings/${file}`, import.meta.url))).toBe(false);
  }
  expect(TABS.map(([id]) => id)).toEqual(["appearance", "audio", "ai", "advanced"]);
  expect(SERVICES).toEqual(["memory", "history", "diagnostics", "about"]);
});

test("row arrays are directly usable by RenderFormikFields, with separate audio/radio values", () => {
  const context = { settings: { radio: {}, audio: {} }, formik: { values: {} } };
  const general = appearanceRows(context),
    audio = audioRows(context),
    ai = processingRows(context);
  expect([general.length, ai.length]).toEqual([6, 6]);
  expect(audio.map(({ tag }) => tag)).toEqual(expect.arrayContaining(["audio.buffer_size", "monitor.wasapiMode"]));
  expect(general.some(({ tag }) => tag === "radio.volume")).toBe(true);
  expect(audio.some(({ tag }) => tag === "audio.volume")).toBe(true);
  for (const row of [...general, ...audio, ...ai]) {
    expect(row.source).toBeUndefined();
    expect(row.optionsKey).toBeUndefined();
    expect(typeof row.parse).not.toBe("string");
  }
});
