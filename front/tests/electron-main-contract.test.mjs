import fs from "node:fs";
import { expect, test } from "vitest";

test("main process registers every preload channel through the trusted boundary", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");
  const preload = fs.readFileSync("electron/preload.cjs", "utf8");
  const exposedChannels = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(
    ([, channel]) => channel
  );
  const trustedChannels = [...main.matchAll(/handleTrustedIpc\("([^"]+)"/g)].map(
    ([, channel]) => channel
  );

  expect(new Set(trustedChannels)).toEqual(new Set(exposedChannels));
  expect(trustedChannels).toHaveLength(new Set(trustedChannels).size);
  expect(main).toMatch(/registerTrustedIpc\(\s*ipcMain,/);
});

test("backend restart attempts reset only after a stable run", () => {
  const main = fs.readFileSync("electron/main.cjs", "utf8");
  const spawnHandler =
    main.match(/childProcess\.once\("spawn", \(\) => \{([\s\S]*?)\n    \}\);/s)?.[1] || "";
  expect(main).toContain("BACKEND_STABLE_RESET_MS");
  expect(spawnHandler).toContain("setTimeout");
  expect(spawnHandler).not.toMatch(/backendRestartAttempts\s*=\s*0\s*;/);
  expect(main).toMatch(
    /setTimeout\(\(\) => \{\s*if \(backendProcess === childProcess\) backendRestartAttempts = 0;/s
  );
});
