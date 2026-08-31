/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { messages } from "../src/i18n/messages";
import appearanceRows from "../src/pages/Settings/appearance-rows";
import audioRows from "../src/pages/Settings/audio-rows";
import processingRows from "../src/pages/Settings/processing-rows";
import SettingsPage from "./helpers/settings-page";

const settings = () => ({
  app: { form: { online_name: "Singer", language: "ru", theme: "dark" }, change: vi.fn(), save: vi.fn() },
  radio: { stations: [] },
  audio: { values: {}, wasapiMode: "shared" }
});

test.each(["ru", "uk", "en"])("settings fields use the %s catalog including placeholders", (language) => {
  render(<SettingsPage tab="appearance" settings={settings()} language={language} />);
  const catalog = messages[language];
  const name = screen.getByLabelText(catalog["settings.appearance.online_name.label"]);
  expect(name.placeholder).toBe(catalog["settings.appearance.online_name.placeholder"]);
  expect(screen.getByRole("button", { name: catalog["settings.appearance.theme.label"] })).toBeTruthy();
  expect(screen.queryByText(/settings\.appearance\./)).toBeNull();
});

test("a locale change updates fields without replacing their draft", () => {
  const state = settings();
  const view = render(<SettingsPage tab="appearance" settings={state} language="ru" />);
  const input = screen.getByLabelText(messages.ru["settings.appearance.online_name.label"]);
  fireEvent.change(input, { target: { value: "Unsaved draft" } });
  view.rerender(<SettingsPage tab="appearance" settings={state} language="en" />);
  expect(screen.getByLabelText(messages.en["settings.appearance.online_name.label"])).toBe(input);
  expect(input.value).toBe("Unsaved draft");
  expect(input.placeholder).toBe(messages.en["settings.appearance.online_name.placeholder"]);
  expect(state.app.save).not.toHaveBeenCalled();
});

test("row factories request the same existing keys in every locale", () => {
  const calls = [];
  for (const locale of ["ru", "uk", "en"]) {
    const keys = [];
    const tr = (key) => {
      expect(messages[locale]).toHaveProperty(key);
      keys.push(key);
      return messages[locale][key];
    };
    const context = { settings: settings(), run: (action) => action(), tr };
    const rows = [...appearanceRows(context), ...audioRows(context), ...processingRows(context)];
    for (const row of rows) {
      row.render?.();
      row.validate?.(0);
    }
    calls.push(keys);
  }
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[1]).toEqual(calls[2]);
});
