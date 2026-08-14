import fs from "node:fs";
import { expect, test } from "vitest";

test("main process registers every preload channel through the trusted boundary", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");
  const preload = fs.readFileSync("electron/preload.cjs", "utf8");
  const exposedChannels = [
    ...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)
  ].map(([, channel]) => channel);
  const trustedChannels = [
    ...main.matchAll(/handleTrustedIpc\("([^"]+)"/g)
  ].map(([, channel]) => channel);

  expect(new Set(trustedChannels)).toEqual(new Set(exposedChannels));
  expect(trustedChannels).toHaveLength(new Set(trustedChannels).size);
  expect(main).toMatch(/registerTrustedIpc\(\s*ipcMain,/);
});
