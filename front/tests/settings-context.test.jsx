/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { deferred } from "./helpers/async.mjs";
import { translateSaved } from "../src/i18n/runtime";
import { same, notCalled, verify } from "./helpers/assertions.mjs";
const mocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  applyTheme: vi.fn((theme) => theme),
  getSavedTheme: vi.fn(() => "dark"),
  getSavedLanguage: vi.fn(() => "uk"),
  saveLanguage: vi.fn((language) => language)
}));
vi.mock("../src/api/client", () => ({
  api: { getAppSettings: mocks.getAppSettings, updateAppSettings: mocks.updateAppSettings }
}));
vi.mock("../src/utils/theme", () => ({
  applyTheme: mocks.applyTheme,
  getSavedTheme: mocks.getSavedTheme
}));
vi.mock("../src/utils/language", () => ({
  getSavedLanguage: mocks.getSavedLanguage,
  saveLanguage: mocks.saveLanguage
}));
let AppSettingsProvider;
let AppSettingsContext;
let INITIAL_APP_SETTINGS_STATE;
let appSettingsReducer;
let useAppSettings;
const trackedSettings = (initial = {}) => {
  let settings = initial;
  const updateSettings = vi.fn((update) => {
    settings = typeof update === "function" ? update(settings) : update;
    return settings;
  });
  return {
    get settings() {
      return settings;
    },
    updateSettings
  };
};
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  vi.resetModules();
  ({
    default: AppSettingsProvider,
    AppSettingsContext,
    INITIAL_APP_SETTINGS_STATE,
    appSettingsReducer
  } = await import("../src/contexts/app-settings"));
  ({ default: useAppSettings } = await import("../src/hooks/useAppSettings"));
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.getAppSettings.mockResolvedValue({});
  mocks.updateAppSettings.mockResolvedValue({});
  mocks.applyTheme.mockImplementation((theme) => theme);
  mocks.getSavedTheme.mockReturnValue("dark");
  mocks.getSavedLanguage.mockReturnValue("uk");
  mocks.saveLanguage.mockImplementation((language) => language);
});
describe("application settings context", () => {
  test("defines exact initial state and preserves unknown reducer actions", () => {
    expect(INITIAL_APP_SETTINGS_STATE).toEqual({ settings: null, isLoading: true, error: null });
    const state = { settings: { theme: "dark" }, isLoading: false, error: null };
    same([appSettingsReducer(state, { type: "UNKNOWN" }), state], [appSettingsReducer(state, { type: "toString" }), state]);
  });
  test("requires its provider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const suppressExpectedError = (event) => event.preventDefault();
    window.addEventListener("error", suppressExpectedError);
    verify([() => renderHook(() => useAppSettings()), 'toThrow', "useAppSettings must be used inside AppSettingsProvider"]);
    window.removeEventListener("error", suppressExpectedError);
    consoleError.mockRestore();
  });
  test("loads, updates and reloads settings", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    mocks.getSavedLanguage.mockReturnValue("uk");
    const initialLoad = deferred();
    const nextLoad = deferred();
    mocks.getAppSettings
      .mockReturnValueOnce(initialLoad.promise)
      .mockReturnValueOnce(nextLoad.promise);
    const wrapper = ({ children }) => (
      <AppSettingsProvider>{children}</AppSettingsProvider>
    );
    const { result } = renderHook(() => useAppSettings(), { wrapper });
    expect(result.current).toMatchObject({ settings: null, isLoading: true, error: null });
    await act(async () => initialLoad.resolve({ theme: "green", language: "uk" })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toEqual({ theme: "green", language: "uk" });
    expect(mocks.applyTheme).toHaveBeenLastCalledWith("green");
    expect(reload).not.toHaveBeenCalled();
    act(() => result.current.updateSettings((value) => ({ ...value, x: 1 })));
    expect(result.current.settings.x).toBe(1);
    act(() => result.current.updateSettings({ theme: "direct" }));
    expect(result.current.settings).toEqual({ theme: "direct" });
    let reloadPromise;
    act(() => { reloadPromise = result.current.reloadSettings(); });
    verify([result.current.isLoading, 'toBe', true], [result.current.error, 'toBeNull']);
    await act(async () => {
      nextLoad.resolve({ theme: "violet", language: "en" });
      await reloadPromise;
    });
    expect(result.current.settings.theme).toBe("violet");
    expect(mocks.saveLanguage).toHaveBeenLastCalledWith("en");
    expect(reload).toHaveBeenCalledOnce();
  });
  test("exposes load errors and ignores a response after unmount", async () => {
    const failure = new Error("offline");
    mocks.getAppSettings.mockRejectedValueOnce(failure);
    const wrapper = ({ children }) => (
      <AppSettingsProvider>{children}</AppSettingsProvider>
    );
    const failed = renderHook(() => useAppSettings(), { wrapper });
    await waitFor(() => expect(failed.result.current.error).toBe(failure));
    expect(failed.result.current.isLoading).toBe(false);
    failed.unmount();
    let resolve;
    mocks.getAppSettings.mockReturnValueOnce( new Promise((done) => { resolve = done; })
    );
    const pending = renderHook(() => useAppSettings(), { wrapper });
    pending.unmount();
    await act(async () => resolve({ theme: "light" }));
    let reject;
    mocks.getAppSettings.mockReturnValueOnce( new Promise((_resolve, fail) => { reject = fail; })
    );
    const rejected = renderHook(() => useAppSettings(), { wrapper });
    rejected.unmount();
    await act(async () => reject(new Error("obsolete")));
  });
  test("only the latest overlapping reload may update context state", async () => {
    const initial = deferred();
    const stale = deferred();
    const latest = deferred();
    mocks.getAppSettings
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise);
    const wrapper = ({ children }) => (
      <AppSettingsProvider>{children}</AppSettingsProvider>
    );
    const hook = renderHook(() => useAppSettings(), { wrapper });
    await act(async () => initial.resolve({ version: 1 }));
    const stalePromise = hook.result.current
      .reloadSettings()
      .catch((error) => error);
    const latestPromise = hook.result.current.reloadSettings();
    await act(async () => latest.resolve({ version: 3 }));
    expect(hook.result.current.settings).toEqual({ version: 3 });
    await act(async () => stale.resolve({ version: 2 }));
    await Promise.all([stalePromise, latestPromise]);
    expect(hook.result.current.settings).toEqual({ version: 3 });
  });
  test("ignores an error from a superseded reload", async () => {
    const initial = deferred();
    const stale = deferred();
    const latest = deferred();
    mocks.getAppSettings
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise);
    const wrapper = ({ children }) => (
      <AppSettingsProvider>{children}</AppSettingsProvider>
    );
    const hook = renderHook(() => useAppSettings(), { wrapper });
    await act(async () => initial.resolve({ version: 1 }));
    const stalePromise = hook.result.current
      .reloadSettings()
      .catch((error) => error);
    const latestPromise = hook.result.current.reloadSettings();
    await act(async () => latest.resolve({ version: 3 }));
    await act(async () => stale.reject(new Error("stale")));
    await Promise.all([stalePromise, latestPromise]);
    verify([hook.result.current, 'toMatchObject', { settings: { version: 3 }, isLoading: false, error: null }]);
  });
});
