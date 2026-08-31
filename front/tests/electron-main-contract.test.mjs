import fs from "node:fs";
import { expect, test } from "vitest";
test("main process registers every preload channel through the trusted boundary", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");
  const preload = fs.readFileSync("electron/preload.cjs", "utf8");
  const exposedChannels = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(([, channel]) => channel);
  const trustedChannels = [...main.matchAll(/handleTrustedIpc\("([^"]+)"/g)].map(([, channel]) => channel);
  expect(new Set(trustedChannels)).toEqual(new Set(exposedChannels));
  expect(trustedChannels).toHaveLength(new Set(trustedChannels).size);
  expect(main).toMatch(/registerTrustedIpc\(\s*ipcMain,/);
});
test("backend restart attempts reset only after a stable run", () => {
  const main = fs.readFileSync("electron/backend-process.cjs", "utf8");
  const spawnHandler = main.match(/childProcess\.once\("spawn", \(\) => \{([\s\S]*?)\n\s*\}\);/s)?.[1] || "";
  expect(main).toContain("BACKEND_STABLE_RESET_MS");
  expect(spawnHandler).toContain("setTimeout");
  const beforeStableTimer = spawnHandler.split("setTimeout", 1)[0];
  expect(beforeStableTimer).not.toMatch(/backendRestartAttempts\s*=\s*0\s*;/);
  expect(main).toMatch(/setTimeout\(\(\) => \{[\s\S]*?backendProcess === childProcess[\s\S]*?backendRestartAttempts = 0;/s);
});
test("desktop audio uses one render quantum for realtime room playback", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");
  expect(main).toContain('app.commandLine.appendSwitch("audio-buffer-size", "128")');
});
