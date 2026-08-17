import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = path.resolve(root, "..");
const { chooseRuntimeBackendEndpoint } = require("../electron/backend-endpoint.cjs");

const fail = (message) => {
  throw new Error(`[portability] ${message}`);
};
const read = (relative) => fs.readFileSync(path.join(projectRoot, relative), "utf8");

// A packaged app must not depend on port 8000 being free on somebody else's PC.
const blocker = net.createServer();
await new Promise((resolve, reject) => {
  blocker.once("error", reject);
  blocker.listen(8000, "127.0.0.1", resolve);
});
try {
  const endpoint = await chooseRuntimeBackendEndpoint({
    isDev: false,
    explicitUrl: "",
    defaultUrl: "http://127.0.0.1:8000"
  });
  if (endpoint.host !== "127.0.0.1" || endpoint.port === 8000 || endpoint.port < 1) {
    fail(`packaged endpoint did not move away from occupied :8000 (${JSON.stringify(endpoint)})`);
  }
} finally {
  await new Promise((resolve) => blocker.close(resolve));
}

const main = read("front/electron/main.cjs");
if (!main.includes("path.dirname(process.execPath)") || !main.includes('"data"')) {
  fail("packaged writable data is not rooted beside the installed executable");
}
if (!/app\.setPath\(\s*\"userData\"/.test(main) || !main.includes('app.setPath("temp"')) {
  fail("Electron profile/temp paths are not redirected into the installation root");
}
if (!main.includes("chooseRuntimeBackendEndpoint")) {
  fail("Electron main is not using the dynamic packaged backend endpoint");
}

const installer = read("scripts/karaoke-studio.iss");
if (!/^PrivilegesRequired=lowest$/m.test(installer)) {
  fail("installer still requires elevation");
}
if (!/^DefaultDirName=\{userdocs\}\\\{#MyAppName\}$/m.test(installer)) {
  fail("fresh installer is not rooted in a normal user-selected writable folder");
}
for (const expected of [
  "{app}\\data\\backend",
  "{app}\\data\\models",
  "{app}\\data\\cache",
  "{app}\\data\\logs",
  "{app}\\.install\\app-runtime.zip"
]) {
  if (!installer.includes(expected)) fail(`installer is missing self-contained path: ${expected}`);
}
if (/\{localappdata\}\\A&D Voice|\{userappdata\}\\A&D Voice/.test(installer)) {
  fail("installer still writes A&D Voice runtime data outside {app}");
}

console.log(
  "Portability audit passed: occupied-port and self-contained install-root storage contracts are enforced."
);
