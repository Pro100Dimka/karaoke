import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const windowState = require("../electron/window-state.cjs");

const { clampWindowBounds, normalizeBounds, readWindowState, writeWindowState } = windowState;

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const left = { x: -2560, y: -320, width: 2560, height: 1400 };

describe("desktop window state", () => {
  test("keeps valid mixed-DPI coordinates on their matching monitor", () => {
    const bounds = { x: -2200, y: -200, width: 1500, height: 900 };
    expect(clampWindowBounds(bounds, [primary, left])).toEqual({
      x: -2200,
      y: -200,
      width: 1500,
      height: 900
    });
  });

  test("returns an off-screen window to the nearest visible work area", () => {
    const bounds = { x: 2500, y: 1600, width: 1400, height: 900 };
    expect(clampWindowBounds(bounds, [primary], { width: 1100, height: 700 })).toEqual({
      x: 520,
      y: 140,
      width: 1400,
      height: 900
    });
  });

  test("fits minimum bounds to a physically smaller display", () => {
    const bounds = { x: -4000, y: 0, width: 1600, height: 1000 };
    const compactDisplay = { x: 0, y: 0, width: 1024, height: 680 };
    const expected = { x: 0, y: 0, width: 1024, height: 680 };
    const restored = clampWindowBounds(bounds, [compactDisplay], { width: 1100, height: 700 });
    expect(restored).toEqual(expected);
  });

  test("rejects corrupt bounds and tolerates a corrupt state file", () => {
    expect(normalizeBounds({ x: 0, y: 0, width: -1, height: 700 })).toBeNull();
    const fs = { readFileSync: vi.fn(() => "not-json") };
    expect(readWindowState(fs, "window-state.json")).toEqual({
      bounds: null,
      fullscreen: true,
      maximized: false
    });
  });

  test("writes state atomically and validates it when read", () => {
    const files = new Map();
    const fs = {
      writeFileSync: vi.fn((file, value) => files.set(file, value)),
      renameSync: vi.fn((from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      }),
      readFileSync: vi.fn((file) => files.get(file))
    };
    const state = {
      bounds: { x: -800, y: 20, width: 1280, height: 720 },
      fullscreen: false,
      maximized: true
    };
    writeWindowState(fs, "window-state.json", state);
    expect(fs.renameSync).toHaveBeenCalledWith("window-state.json.tmp", "window-state.json");
    expect(readWindowState(fs, "window-state.json")).toEqual(state);
  });
});
