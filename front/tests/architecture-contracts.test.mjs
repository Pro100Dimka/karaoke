import fs from "node:fs";
import { createRequire } from "node:module";
import { expect, test, vi } from "vitest";
import { createRoomSyncChannel } from "../src/services/roomSyncChannel";
import { createLevelMeter } from "../src/services/levelMeter";
import { isValidSongRevision } from "../src/services/onlineRoom";

const require = createRequire(import.meta.url);
const { readThemeBackgrounds } = require("../electron/theme-backgrounds.cjs");

test("native window reads the packaged renderer palette, without independent colors", () => {
  expect(readThemeBackgrounds()).toEqual({ dark: "#050001", light: "#fffaf7", green: "#020904", violet: "#06020f" });
  expect(readThemeBackgrounds(':root {--color-bg: #123456;} [data-theme="light"] {--color-bg: #abcdef;}')).toEqual({
    dark: "#123456",
    light: "#abcdef"
  });
  expect(() => readThemeBackgrounds(":root {} ")).toThrow();
  expect(JSON.parse(fs.readFileSync("package.json", "utf8")).build.files).toContain("src/theme/palettes.css");
  for (const file of ["src/utils/theme.js", "src/main.jsx", "electron/main.cjs"])
    expect(fs.readFileSync(file, "utf8")).not.toMatch(/#[\da-f]{6}/i);
});

test("default tokens have one definition and UI import does not overwrite them inline", () => {
  const css = fs.readFileSync("src/theme/tokens.css", "utf8");
  const tokens = [...css.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name);
  expect(tokens.length).toBe(new Set(tokens).size);
  expect(css).toContain("--shadows-3: var(--shadow-lg)");
  expect(fs.readFileSync("src/theme/ui/base.js", "utf8")).not.toContain("createTheme");
  expect(fs.existsSync("src/theme/ui/ConfigForm/index.jsx")).toBe(false);
});

test("room state waits for remote application, suppresses echo and permits the next local edit", () => {
  const channel = createRoomSyncChannel();
  expect(channel.shouldSend({ volume: 1 })).toBe(true);
  expect(channel.shouldSend({ volume: 1 })).toBe(false);
  expect(channel.receiveState({ volume: 0.5 }, { volume: 1 })).toBe(true);
  expect(channel.shouldSend({ volume: 1 })).toBe(false);
  expect(channel.shouldSend({ volume: 0.5 })).toBe(false);
  expect(channel.shouldSend({ volume: 0.8 })).toBe(true);
  expect(channel.receiveState({ volume: 0.8 }, { volume: 0.8 })).toBe(false);
});

test("guest initial state, command duplicates and cancelled scheduling share the guard", () => {
  const channel = createRoomSyncChannel({ speed: 1 });
  expect(channel.shouldSend({ speed: 1 })).toBe(false);
  expect(channel.acceptCommand("play-1")).toBe(true);
  expect(channel.acceptCommand("pause-2")).toBe(true);
  expect(channel.acceptCommand("play-1")).toBe(false);
  channel.cancelCommand("play-1");
  expect(channel.acceptCommand("play-1")).toBe(true);
  expect(createRoomSyncChannel().acceptCommand("pause-2")).toBe(true);
});

test("level meters reuse buffers and preserve RMS and spectrum semantics", () => {
  const analyser = {
    frequencyBinCount: 128,
    getByteTimeDomainData: vi.fn((data) => data.fill(192)),
    getByteFrequencyData: vi.fn((data) => data.fill(64))
  };
  const context = { createAnalyser: () => analyser };
  const time = createLevelMeter(context, { smoothingTimeConstant: 0.45 });
  expect(time.read()).toBe(0.5);
  expect(time.read()).toBe(0.5);
  expect(analyser.getByteTimeDomainData.mock.calls[0][0]).toBe(analyser.getByteTimeDomainData.mock.calls[1][0]);
  expect(analyser.smoothingTimeConstant).toBe(0.45);
  const spectrum = createLevelMeter(context, { domain: "frequency" });
  expect([...spectrum.read()]).toEqual(Array(128).fill(64));
  expect(createLevelMeter({})).toBeNull();
});

test("song revision validation preserves the existing wire contract", () => {
  expect(isValidSongRevision("sha256:" + "a".repeat(64))).toBe(true);
  for (const value of [null, undefined, 0, {}, "", "md5:abc"]) expect(isValidSongRevision(value)).toBe(false);
});
