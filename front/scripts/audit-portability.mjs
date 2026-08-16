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
if (!main.includes("process.env.LOCALAPPDATA") || !main.includes('"backend-data"')) {
  fail("packaged backend data is not rooted in LOCALAPPDATA");
}
if (!main.includes("chooseRuntimeBackendEndpoint")) {
  fail("Electron main is not using the dynamic packaged backend endpoint");
}

const installer = read("scripts/karaoke-studio.iss");
if (!/^PrivilegesRequired=lowest$/m.test(installer)) {
  fail("installer still requires elevation and can write per-user data under another account");
}
if (!/^DefaultDirName=\{localappdata\}\\Programs\\\{#MyAppName\}$/m.test(installer)) {
  fail("fresh installer is not per-user under LOCALAPPDATA\\Programs");
}
if (!installer.includes("{localappdata}\\A&D Voice\\backend-data")) {
  fail("installer/backend disagree about the packaged backend data root");
}

console.log(
  "Portability audit passed: occupied-port, per-user installer, and LocalAppData contracts are enforced."
);
