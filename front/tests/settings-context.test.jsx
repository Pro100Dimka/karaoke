/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { translateSaved } from "../src/i18n/runtime";

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

let AppSettingsProvider;
let AppSettingsContext;
let INITIAL_APP_SETTINGS_STATE;
let appSettingsReducer;
let useAppSettings;
let useSettingsForm;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  vi.resetModules();
  ({
    default: AppSettingsProvider,
    AppSettingsContext,
    INITIAL_APP_SETTINGS_STATE,
    appSettingsReducer
  } = await import("../src/contexts/app-settings"));
  ({ default: useAppSettings } = await import("../src/hooks/useAppSettings"));
  ({ default: useSettingsForm } = await import("../src/hooks/useSettingsForm"));
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
    expect(INITIAL_APP_SETTINGS_STATE).toEqual({
      settings: null,
      isLoading: true,
      error: null
    });
    const state = {
      settings: { theme: "dark" },
      isLoading: false,
      error: null
    };
    expect(appSettingsReducer(state, { type: "UNKNOWN" })).toBe(state);
    expect(appSettingsReducer(state, { type: "toString" })).toBe(state);
  });
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

    expect(result.current).toMatchObject({
      settings: null,
      isLoading: true,
      error: null
    });
    await act(async () =>
      initialLoad.resolve({ theme: "green", language: "uk" })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toEqual({
      theme: "green",
      language: "uk"
    });
    expect(mocks.applyTheme).toHaveBeenLastCalledWith("green");
    expect(reload).not.toHaveBeenCalled();

    act(() => result.current.updateSettings((value) => ({ ...value, x: 1 })));
    expect(result.current.settings.x).toBe(1);
    act(() => result.current.updateSettings({ theme: "direct" }));
    expect(result.current.settings).toEqual({ theme: "direct" });

    let reloadPromise;
    act(() => {
      reloadPromise = result.current.reloadSettings();
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
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
    mocks.getAppSettings.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      })
    );
    const pending = renderHook(() => useAppSettings(), { wrapper });
    pending.unmount();
    await act(async () => resolve({ theme: "light" }));

    let reject;
    mocks.getAppSettings.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      })
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
    expect(hook.result.current).toMatchObject({
      settings: { version: 3 },
      isLoading: false,
      error: null
    });
  });
});

describe("settings form", () => {
  test("loads, edits and saves the complete form", async () => {
    const global = trackedSettings({ persisted: true });
    const notify = vi.fn();
    mocks.getAppSettings.mockResolvedValueOnce({
      theme: "dark",
      online_name: "Singer"
    });
    const saving = deferred();
    mocks.updateAppSettings.mockReturnValueOnce(saving.promise);
    const { result } = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue(global.updateSettings))
    });

    expect(result.current).toMatchObject({
      form: null,
      saveStatus: "idle",
      saving: false,
      saved: false
    });
    await waitFor(() => expect(result.current.form?.theme).toBe("dark"));
    expect(mocks.applyTheme).toHaveBeenCalledTimes(1);
    expect(mocks.applyTheme).toHaveBeenLastCalledWith("dark");
    act(() => result.current.updateField("online_name", "New name"));
    expect(result.current.form.online_name).toBe("New name");
    expect(global.updateSettings).not.toHaveBeenCalled();
    act(() => result.current.updateField("theme", "green"));
    await waitFor(() =>
      expect(mocks.applyTheme).toHaveBeenLastCalledWith("green")
    );
    expect(mocks.applyTheme).toHaveBeenCalledTimes(2);
    expect(global.settings).toEqual({ persisted: true, theme: "green" });

    let savePromise;
    act(() => {
      savePromise = result.current.save();
    });
    expect(result.current).toMatchObject({
      saveStatus: "saving",
      saving: true,
      saved: false
    });
    await waitFor(() => expect(mocks.updateAppSettings).toHaveBeenCalledOnce());
    expect(mocks.updateAppSettings).toHaveBeenCalledWith({
      theme: "green",
      online_name: "New name"
    });
    saving.resolve({ language: "en" });
    await act(() => savePromise);
    expect(result.current.form).toMatchObject({
      theme: "green",
      language: "en"
    });
    expect(result.current).toMatchObject({
      saveStatus: "saved",
      saving: false,
      saved: true
    });
    expect(global.settings).toEqual({
      persisted: true,
      theme: "green",
      language: "en"
    });
    expect(notify).not.toHaveBeenCalled();

    act(() => result.current.updateField("online_name", "Edited again"));
    expect(result.current).toMatchObject({
      saveStatus: "idle",
      saving: false,
      saved: false
    });
  });

  test("trims fields and uses either returned or submitted values", async () => {
    const updateSettings = vi.fn((update) => update({ persisted: true }));
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

  test("stays saving until every queued write settles", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    mocks.getAppSettings.mockResolvedValueOnce({ language: "uk" });
    const first = deferred();
    const second = deferred();
    mocks.updateAppSettings
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const hook = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue())
    });
    await waitFor(() => expect(hook.result.current.form).not.toBeNull());

    let firstSave;
    let secondSave;
    act(() => {
      firstSave = hook.result.current.saveField("language", "en");
      secondSave = hook.result.current.saveField("online_name", "Singer");
    });
    expect(hook.result.current).toMatchObject({
      saveStatus: "saving",
      saving: true,
      saved: false
    });
    await waitFor(() =>
      expect(mocks.updateAppSettings).toHaveBeenCalledTimes(1)
    );

    first.resolve({ language: "en" });
    await act(() => firstSave);
    await waitFor(() =>
      expect(mocks.updateAppSettings).toHaveBeenCalledTimes(2)
    );
    expect(hook.result.current.saveStatus).toBe("saving");

    second.reject(new Error("second failed"));
    await act(() => secondSave);
    expect(hook.result.current).toMatchObject({
      saveStatus: "idle",
      saving: false,
      saved: false
    });
    expect(notify).toHaveBeenCalledWith(
      translateSaved("Не удалось сохранить настройку: {0}", {
        0: "second failed"
      })
    );
  });

  test("reports load, form-save and field-save failures", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    mocks.getAppSettings.mockRejectedValueOnce(new Error("load failed"));
    const load = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue())
    });
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        translateSaved("Не удалось загрузить настройки: {0}", {
          0: "load failed"
        })
      )
    );
    expect(load.result.current.form).toBeNull();
    await act(() => load.result.current.save());
    expect(mocks.updateAppSettings).not.toHaveBeenCalled();
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
    expect(failed.result.current).toMatchObject({
      saveStatus: "idle",
      saving: false,
      saved: false
    });
    await act(() => failed.result.current.saveField("theme", "light"));
    expect(notify.mock.calls).toEqual([
      [
        translateSaved("Не удалось сохранить: {0}", {
          0: "save failed"
        })
      ],
      [
        translateSaved("Не удалось сохранить настройку: {0}", {
          0: "field failed"
        })
      ]
    ]);
    expect(failed.result.current).toMatchObject({
      saveStatus: "idle",
      saving: false,
      saved: false
    });
  });

  test("ignores superseded whole-form and field responses", async () => {
    const notify = vi.fn();
    const global = trackedSettings();
    mocks.getAppSettings.mockResolvedValueOnce({ theme: "dark" });
    let releaseFirstSave;
    mocks.updateAppSettings
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseFirstSave = resolve;
        })
      )
      .mockResolvedValueOnce({ theme: "new" })
      .mockRejectedValueOnce(new Error("stale field"))
      .mockResolvedValueOnce({ language: "uk" });
    const hook = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue(global.updateSettings))
    });
    await waitFor(() => expect(hook.result.current.form).not.toBeNull());
    const firstSave = hook.result.current.save();
    const secondSave = hook.result.current.save();
    releaseFirstSave({ theme: "old" });
    await act(async () => {
      await firstSave;
      await secondSave;
    });
    expect(hook.result.current.form.theme).toBe("new");
    expect(global.updateSettings).toHaveBeenCalledTimes(1);
    expect(global.settings).toEqual({ theme: "new" });

    const staleField = hook.result.current.saveField("language", "en");
    const currentField = hook.result.current.saveField("language", "uk");
    await act(async () => {
      await staleField;
      await currentField;
    });
    expect(hook.result.current.form.language).toBe("uk");
    expect(global.updateSettings).toHaveBeenCalledTimes(2);
    expect(global.settings).toEqual({ theme: "new", language: "uk" });
    expect(notify).not.toHaveBeenCalled();

    mocks.updateAppSettings
      .mockResolvedValueOnce({ online_name: "stale" })
      .mockResolvedValueOnce({ online_name: "current" });
    const staleSuccess = hook.result.current.saveField("online_name", "old");
    const currentSuccess = hook.result.current.saveField(
      "online_name",
      "current"
    );
    await act(async () => {
      await staleSuccess;
      await currentSuccess;
    });
    expect(hook.result.current.form.online_name).toBe("current");
    expect(global.updateSettings).toHaveBeenCalledTimes(3);
    expect(global.settings).toEqual({
      theme: "new",
      language: "uk",
      online_name: "current"
    });

    mocks.updateAppSettings
      .mockRejectedValueOnce(new Error("stale save"))
      .mockResolvedValueOnce({ theme: "final" });
    const staleFailure = hook.result.current.save();
    const currentSave = hook.result.current.save();
    await act(async () => {
      await staleFailure;
      await currentSave;
    });
    expect(hook.result.current.form.theme).toBe("final");
    expect(global.updateSettings).toHaveBeenCalledTimes(4);
    expect(global.settings).toEqual({
      theme: "final",
      language: "uk",
      online_name: "current"
    });
    expect(notify).not.toHaveBeenCalled();
  });

  test("ignores settings load completion after unmount", async () => {
    let resolveLoad;
    mocks.getAppSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve;
      })
    );
    const resolved = renderHook(() => useSettingsForm(vi.fn()), {
      wrapper: contextWrapper(contextValue())
    });
    resolved.unmount();
    resolveLoad({ theme: "late" });
    await act(async () => Promise.resolve());

    let rejectLoad;
    const notify = vi.fn();
    mocks.getAppSettings.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      })
    );
    const rejected = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue())
    });
    rejected.unmount();
    rejectLoad(new Error("late"));
    await act(async () => Promise.resolve());
    expect(notify).not.toHaveBeenCalled();
  });

  test("ignores save completions after unmount", async () => {
    mocks.getAppSettings.mockResolvedValue({ theme: "dark" });
    const fullSave = deferred();
    const fieldSave = deferred();
    mocks.updateAppSettings
      .mockReturnValueOnce(fullSave.promise)
      .mockReturnValueOnce(fieldSave.promise);
    const notify = vi.fn();
    const global = trackedSettings();
    const full = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue(global.updateSettings))
    });
    await waitFor(() => expect(full.result.current.form).not.toBeNull());
    const fullPromise = full.result.current.save();
    await waitFor(() => expect(mocks.updateAppSettings).toHaveBeenCalledOnce());
    full.unmount();
    fullSave.reject(new Error("late full failure"));
    await act(() => fullPromise);

    const field = renderHook(() => useSettingsForm(notify), {
      wrapper: contextWrapper(contextValue(global.updateSettings))
    });
    await waitFor(() => expect(field.result.current.form).not.toBeNull());
    const fieldPromise = field.result.current.saveField("theme", "late");
    await waitFor(() =>
      expect(mocks.updateAppSettings).toHaveBeenCalledTimes(2)
    );
    field.unmount();
    fieldSave.reject(new Error("late failure"));
    await act(() => fieldPromise);

    expect(global.updateSettings).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test("ignores successful save completions after unmount", async () => {
    mocks.getAppSettings.mockResolvedValue({ theme: "dark" });
    const fullSave = deferred();
    const fieldSave = deferred();
    mocks.updateAppSettings
      .mockReturnValueOnce(fullSave.promise)
      .mockReturnValueOnce(fieldSave.promise);
    const global = trackedSettings();

    const full = renderHook(() => useSettingsForm(vi.fn()), {
      wrapper: contextWrapper(contextValue(global.updateSettings))
    });
    await waitFor(() => expect(full.result.current.form).not.toBeNull());
    const fullPromise = full.result.current.save();
    await waitFor(() => expect(mocks.updateAppSettings).toHaveBeenCalledOnce());
    full.unmount();
    fullSave.resolve({ theme: "late" });
    await act(() => fullPromise);

    const field = renderHook(() => useSettingsForm(vi.fn()), {
      wrapper: contextWrapper(contextValue(global.updateSettings))
    });
    await waitFor(() => expect(field.result.current.form).not.toBeNull());
    const fieldPromise = field.result.current.saveField("theme", "late");
    await waitFor(() =>
      expect(mocks.updateAppSettings).toHaveBeenCalledTimes(2)
    );
    field.unmount();
    fieldSave.resolve({ theme: "late" });
    await act(() => fieldPromise);

    expect(global.updateSettings).not.toHaveBeenCalled();
  });
});
