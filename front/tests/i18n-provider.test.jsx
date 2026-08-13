/* @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ settings: { language: "en" } }));

vi.mock("../src/hooks/useAppSettings", () => ({
  default: () => ({ settings: state.settings })
}));

import {
  I18nProvider,
  translateMessage,
  useI18n
} from "../src/i18n/index.jsx";

function Consumer() {
  const { language, t } = useI18n();
  return <span>{`${language}:${t("status.cancelled")}`}</span>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  state.settings = { language: "en" };
});

test("provider exposes selected language and translates messages", () => {
  render(
    <I18nProvider>
      <Consumer />
    </I18nProvider>
  );
  expect(screen.getByText("en:Cancelled")).toBeTruthy();
  expect(document.documentElement.lang).toBe("en");
  expect(translateMessage("en", "settings.history.seconds", { count: 7 })).toBe(
    "7 s"
  );
});

test("provider falls back to Ukrainian for unsupported settings", () => {
  state.settings = { language: "invalid" };
  render(
    <I18nProvider>
      <Consumer />
    </I18nProvider>
  );
  expect(screen.getByText("uk:Скасовано")).toBeTruthy();
  expect(document.documentElement.lang).toBe("uk");
});

test("hook rejects usage outside its provider", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const preventWindowError = (event) => event.preventDefault();
  window.addEventListener("error", preventWindowError);
  expect(() => render(<Consumer />)).toThrow(
    "useI18n must be used inside I18nProvider"
  );
  window.removeEventListener("error", preventWindowError);
});
