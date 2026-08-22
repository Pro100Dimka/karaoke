/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import useFullscreen from "../src/pages/Karaoke/hooks/useFullscreen";
import { verify } from "./helpers/assertions.mjs";
afterEach(() => {
  cleanup();
  delete window.electronAPI;
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
});
describe("useFullscreen", () => {
  test("tracks the DOM fullscreenchange event when Electron is unavailable", () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);
    Object.defineProperty(document, "fullscreenElement", {
      value: document.body,
      configurable: true
    });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    expect(result.current.isFullscreen).toBe(true);
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    expect(result.current.isFullscreen).toBe(false);
  });
  test("toggleFullscreen uses the DOM Fullscreen API when Electron is unavailable", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;
    const { result } = renderHook(() => useFullscreen());
    act(() => result.current.toggleFullscreen());
    verify([requestFullscreen, "toHaveBeenCalled"], [exitFullscreen, "not.toHaveBeenCalled"]);
    Object.defineProperty(document, "fullscreenElement", {
      value: document.body,
      configurable: true
    });
    act(() => result.current.toggleFullscreen());
    expect(exitFullscreen).toHaveBeenCalled();
  });
  test("prefers Electron's native fullscreen IPC when available", () => {
    // Electron's native window fullscreen also hides the OS taskbar, which
    // the DOM Fullscreen API cannot do -- and it never fires the DOM
    // fullscreenchange event, so the main process reports state changes
    // through its own channel instead.
    const toggleFullscreen = vi.fn().mockResolvedValue(true);
    let emit;
    const onFullscreenChange = vi.fn((callback) => {
      emit = callback;
      return vi.fn();
    });
    window.electronAPI = { toggleFullscreen, onFullscreenChange };
    const { result, unmount } = renderHook(() => useFullscreen());
    expect(onFullscreenChange).toHaveBeenCalled();
    act(() => result.current.toggleFullscreen());
    expect(toggleFullscreen).toHaveBeenCalled();
    act(() => emit(true));
    expect(result.current.isFullscreen).toBe(true);
    unmount();
  });
  test("unsubscribes from the Electron channel on unmount", () => {
    const unsubscribe = vi.fn();
    window.electronAPI = {
      toggleFullscreen: vi.fn(),
      onFullscreenChange: vi.fn(() => unsubscribe)
    };
    const { unmount } = renderHook(() => useFullscreen());
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
