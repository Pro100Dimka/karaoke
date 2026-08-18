/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { verify } from "./helpers/assertions.mjs";
const state = vi.hoisted(() => ({ settings: { language: "en" } }));
vi.mock("../src/hooks/useAppSettings", () => ({ default: () => ({ settings: state.settings }) }));
import { I18nProvider, messages, translateMessage, useI18n } from "../src/i18n/index.jsx";
function Consumer() {
  const { language, t } = useI18n();
  return <span>{`${language}:${t("status.cancelled")}`}</span>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); state.settings = { language: "en" }; });
test("provider exposes selected language and translates messages", () => {
  render( <I18nProvider> <Consumer /> </I18nProvider>
  );
  verify([screen.getByText("en:Cancelled"), 'toBeTruthy'], [document.documentElement.lang, 'toBe', "en"]);
  verify([translateMessage("en", "settings.history.seconds", { count: 7 }), 'toBe', "7 s"]);
});
test("provider falls back to Ukrainian for unsupported settings", () => {
  state.settings = { language: "invalid" };
  render( <I18nProvider> <Consumer /> </I18nProvider>
  );
  verify([screen.getByText("uk:Скасовано"), 'toBeTruthy'], [document.documentElement.lang, 'toBe', "uk"]);
});
test("provider handles absent settings and reacts to a language change", () => {
  state.settings = null;
  const view = render( <I18nProvider> <Consumer /> </I18nProvider>
  );
  expect(
    screen.getByText(`uk:${messages.uk["status.cancelled"]}`)
  ).toBeTruthy();
  state.settings = { language: "ru" };
  view.rerender( <I18nProvider> <Consumer /> </I18nProvider>
  );
  expect(
    screen.getByText(`ru:${messages.ru["status.cancelled"]}`)
  ).toBeTruthy();
  expect(document.documentElement.lang).toBe("ru");
});
test("hook rejects usage outside its provider", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const preventWindowError = (event) => event.preventDefault();
  window.addEventListener("error", preventWindowError);
  verify([() => render(<Consumer />), 'toThrow', "useI18n must be used inside I18nProvider"]);
  window.removeEventListener("error", preventWindowError);
});
test("all UI locale catalogs expose the same unique keys", () => {
  const catalogs = Object.values(messages);
  const expected = Object.keys(messages.uk).sort();
  expect(expected.length).toBeGreaterThan(150);
  for (const catalog of catalogs) {
    const keys = Object.keys(catalog);
    verify([keys, 'toHaveLength', new Set(keys).size], [keys.sort(), 'toEqual', expected]);
  }
});
