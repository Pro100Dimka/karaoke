/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ settings: { online_name: "Old", theme: "dark" }, update: vi.fn(), save: vi.fn() }));
vi.mock("../src/hooks/useAppSettings", () => ({ default: () => ({ settings: state.settings, updateSettings: state.update }) }));
vi.mock("../src/api/client", () => ({ api: { updateAppSettings: state.save } }));
vi.mock("../src/hooks/usePolling", () => ({ usePolling: () => ({ data: null, refresh: vi.fn() }) }));
vi.mock("../src/contexts/AppDialog", () => ({ useAppDialog: () => ({ alert: vi.fn() }) }));
vi.mock("../src/contexts/radio", () => ({ useRadio: () => ({}) }));
import useSettings from "../src/pages/Settings/use-settings";

beforeEach(() => vi.clearAllMocks());

test("reads the existing settings context and persists only the changed key", async () => {
  state.save.mockResolvedValue({ online_name: null, theme: "stale theme" });
  const { result } = renderHook(() => useSettings(false));
  expect(result.current.app.form).toBe(state.settings);
  await act(async () => result.current.app.save("online_name", ""));
  expect(state.save).toHaveBeenCalledWith({ online_name: null });
  expect(state.update.mock.calls[0][0]({ online_name: "Old", theme: "green" })).toEqual({ online_name: null, theme: "green" });
});

test("queued writes ignore stale responses and recover after a rejected request", async () => {
  state.save.mockResolvedValueOnce({ online_name: "One" }).mockResolvedValueOnce({ online_name: "Two" });
  const { result } = renderHook(() => useSettings(false));
  await act(async () => {
    await Promise.all([result.current.app.save("online_name", "One"), result.current.app.save("online_name", "Two")]);
  });
  expect(state.update).toHaveBeenCalledOnce();
  expect(state.update.mock.calls[0][0]({}).online_name).toBe("Two");
  state.save.mockRejectedValueOnce(new Error("Offline"));
  await expect(result.current.app.save("online_name", "Three")).rejects.toThrow("Offline");
  state.save.mockResolvedValueOnce({ online_name: "Four" });
  await act(async () => result.current.app.save("online_name", "Four"));
  expect(state.update.mock.lastCall[0]({}).online_name).toBe("Four");
});
