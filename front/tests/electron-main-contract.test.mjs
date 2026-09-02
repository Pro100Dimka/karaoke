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
test("terminateBackend always dispatches the tree-kill regardless of who already soft-killed the process", () => {
  const main = fs.readFileSync("electron/backend-process.cjs", "utf8");
  const terminateBody = main.match(/const terminateBackend = \(\) => \{([\s\S]*?)\n\s*\};/s)?.[1] || "";
  // The health-check watchdog can call childProcess.kill() on the same
  // process object and win the race to flip .killed first -- gating the
  // taskkill /T /F tree-kill on "!backendProcess.killed" would then skip it
  // entirely, precisely for a hung backend where the tree-kill matters most.
  expect(terminateBody).not.toMatch(/if\s*\(\s*backendProcess\s*&&\s*!backendProcess\.killed\s*\)/);
  expect(terminateBody).toContain("taskkill");
});
test("stopBackend returns a promise so app quit can wait for the grace-period kill", () => {
  const main = fs.readFileSync("electron/backend-process.cjs", "utf8");
  const stopBody = main.match(/function stopBackend\(\) \{([\s\S]*?)\n {2}\}/s)?.[1] || "";
  // Without this, Electron could finish quitting before the grace timer (and
  // its taskkill /T /F) ever runs, orphaning the Python backend.
  expect(stopBody).toMatch(/return backendStopPromise;?\s*$/m);
});
test("app quit is gated on stopBackend finishing, not fired off unawaited", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");
  const beforeQuit = main.match(/app\.on\("before-quit", \(event\) => \{([\s\S]*?)\n\}\);/s)?.[1] || "";
  expect(beforeQuit).toContain("event.preventDefault()");
  expect(beforeQuit).toMatch(/stopBackend\(\)/);
  expect(beforeQuit).toMatch(/\.finally\(/);
});
test("desktop audio uses one render quantum for realtime room playback", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");
  expect(main).toContain('app.commandLine.appendSwitch("audio-buffer-size", "128")');
});

test("minimize releases optional hardware and restore reacquires persisted monitoring", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");
  const preload = fs.readFileSync("electron/preload.cjs", "utf8");
  const backendProcess = fs.readFileSync("electron/backend-process.cjs", "utf8");

  expect(main).toMatch(/mainWindow\.on\("minimize"[\s\S]*?backend\.suspendHardware\(\)/);
  expect(main).toMatch(/mainWindow\.on\("restore"[\s\S]*?backend\.resumeHardware\(\)/);
  expect(main).toContain('webContents.send("app:hardware-suspension-changed", true)');
  expect(main).toContain('webContents.send("app:hardware-suspension-changed", false)');
  expect(preload).toContain('ipcRenderer.on("app:hardware-suspension-changed"');
  expect(backendProcess).toContain("/audio/direct-monitor/suspend");
  expect(backendProcess).toContain("/audio/direct-monitor/resume");
});
