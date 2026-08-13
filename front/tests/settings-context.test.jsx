/* @vitest-environment jsdom */
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  applyTheme: vi.fn((theme) => theme),
  getSavedTheme: vi.fn(() => "dark"),
  getSavedLanguage: vi.fn(() => "uk"),
  saveLanguage: vi.fn((language) => language)
}));

vi.mock("../src/api/client", () => ({
  api: {
    getAppSettings: mocks.getAppSettings,
    updateAppSettings: mocks.updateAppSettings
  }
}));
vi.mock("../src/utils/theme", () => ({
  applyTheme: mocks.applyTheme,
  getSavedTheme: mocks.getSavedTheme
}));
vi.mock("../src/utils/language", () => ({
  getSavedLanguage: mocks.getSavedLanguage,
  saveLanguage: mocks.saveLanguage
}));

import AppSettingsProvider, {
  AppSettingsContext
} from "../src/contexts/app-settings.jsx";
import useAppSettings from "../src/hooks/useAppSettings.js";
import useSettingsForm from "../src/hooks/useSettingsForm.js";

const contextValue = (updateSettings = vi.fn()) => ({
  settings: {},
  isLoading: false,
  error: null,
  updateSettings,
  reloadSettings: vi.fn()
});

const contextWrapper = (value) =>
  function ContextWrapper({ children }) {
    return (
      <AppSettingsContext.Provider value={value}>
        {children}
      </AppSettingsContext.Provider>
    );
  };

afterEach(cleanup);
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getAppSettings.mockResolvedValue({});
  mocks.updateAppSettings.mockResolvedValue({});
  mocks.applyTheme.mockImplementation((theme) => theme);
  mocks.getSavedTheme.mockReturnValue("dark");
  mocks.getSavedLanguage.mockReturnValue("uk");
  mocks.saveLanguage.mockImplementation((language) => language);
});

describe("application settings context", () => {
  test("requires its provider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const suppressExpectedError = (event) => event.preventDefault();
    window.addEventListener("error", suppressExpectedError);
    expect(() => renderHook(() => useAppSettings())).toThrow(
      "useAppSettings must be used inside AppSettingsProvider"
    );
    window.removeEventListener("error", suppressExpectedError);
    consoleError.mockRestore();
  });

  test("loads, updates and reloads settings", async () => {
    mocks.getSavedLanguage.mockReturnValueOnce("uk").mockReturnValueOnce("en");
    mocks.getAppSettings
      .mockResolvedValueOnce({ theme: "green", language: "uk" })
      .mockResolvedValueOnce({ theme: "violet", language: "en" });
    const wrapper = ({ children }) => (
      <AppSettingsProvider>{children}</AppSettingsProvider>
    );
    const { result } = renderHook(() => useAppSettings(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toEqual({
      theme: "green",
      language: "uk"
    });
    expect(mocks.applyTheme).toHaveBeenLastCalledWith("green");

    act(() => result.current.updateSettings((value) => ({ ...value, x: 1 })));
    expect(result.current.settings.x).toBe(1);

    await act(() => result.current.reloadSettings());
    expect(result.current.settings.theme).toBe("violet");
    expect(mocks.saveLanguage).toHaveBeenLastCalledWith("en");
  });

  test("exposes load errors and ignores a response after unmount", async () => {
    const failure = new Error("offline");
    mocks.getAppSettings.mockRejectedValueOnce(failure);
    const wrapper = ({ children }) => (
      <AppSettingsProvider>{children}</AppSettingsProvider>
    );
    const failed = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(failed.result.current.error).toBe(failure));
    failed.unmount();

    let resolve;
    mocks.getAppSettings.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = renderHook(() => useAppSettings(), { wrapper });
    pending.unmount();
    await act(async () => resolve({ theme: "light" }));
  });
});

describe("settings form", () => {
  test("loads, edits and saves the complete form", async () => {
    const updateSettings = vi.fn();
    const notify = vi.fn();
    mocks.getAppSettings.mockResolvedValueOnce({
      theme: "dark",
      online_name: "Singer"
    });
    mocks.updateAppSettings.mockResolvedValueOnce({ language: "en" });
    const { result } = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue(updateSettings))
    });

    await waitFor(() => expect(result.current.form?.theme).toBe("dark"));
    act(() => result.current.updateField("online_name", "New name"));
    expect(result.current.form.online_name).toBe("New name");
    act(() => result.current.updateField("theme", "green"));
    expect(mocks.applyTheme).toHaveBeenLastCalledWith("green");
    expect(updateSettings).toHaveBeenCalled();

    await act(() => result.current.save());
    expect(mocks.updateAppSettings).toHaveBeenCalledWith({
      theme: "green",
      online_name: "New name"
    });
    expect(result.current.form).toMatchObject({
      theme: "green",
      language: "en"
    });
    expect(result.current.saved).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  test("trims fields and uses either returned or submitted values", async () => {
    const updateSettings = vi.fn();
    const notify = vi.fn();
    mocks.getAppSettings.mockResolvedValueOnce({ online_name: "Before" });
    mocks.updateAppSettings.mockImplementation((payload) =>
      Promise.resolve(
        Object.hasOwn(payload, "online_name")
          ? { online_name: "Canonical" }
          : null
      )
    );
    const { result } = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue(updateSettings))
    });
    await waitFor(() => expect(result.current.form).not.toBeNull());

    await act(() => result.current.saveField("online_name", "  Singer  "));
    expect(mocks.updateAppSettings).toHaveBeenNthCalledWith(1, {
      online_name: "Singer"
    });
    expect(result.current.form.online_name).toBe("Canonical");

    await act(() => result.current.saveField("latency", 12));
    expect(result.current.form.latency).toBe(12);
    expect(result.current.saved).toBe(true);
  });

  test("reports load, form-save and field-save failures", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    mocks.getAppSettings.mockRejectedValueOnce(new Error("load failed"));
    const load = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue())
    });
    await waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(load.result.current.form).toBeNull();
    await act(() => load.result.current.save());
    load.unmount();

    notify.mockClear();
    mocks.getAppSettings.mockResolvedValueOnce({ theme: "dark" });
    mocks.updateAppSettings
      .mockRejectedValueOnce(new Error("save failed"))
      .mockRejectedValueOnce(new Error("field failed"));
    const failed = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue())
    });
    await waitFor(() => expect(failed.result.current.form).not.toBeNull());
    await act(() => failed.result.current.save());
    expect(failed.result.current.saveStatus).toBe("idle");
    await act(() => failed.result.current.saveField("theme", "light"));
    expect(notify).toHaveBeenCalledTimes(2);
    expect(failed.result.current.saved).toBe(false);
  });
});
