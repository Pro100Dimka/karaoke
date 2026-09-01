import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { chooseRuntimeBackendEndpoint } = require("../electron/backend-endpoint.cjs");

const check = (ok, message) => {
  if (!ok) throw new Error(`[portability] ${message}`);
};

const blocker = net.createServer();
await new Promise((resolve, reject) =>
  blocker.once("error", reject).listen(0, "127.0.0.1", resolve)
);
const blockedPort = blocker.address().port;

try {
  const { host, port } = await chooseRuntimeBackendEndpoint({
    isDev: false,
    explicitUrl: "",
    defaultUrl: `http://127.0.0.1:${blockedPort}`
  });
  check(
    host === "127.0.0.1" && port > 0 && port !== blockedPort,
    `backend endpoint stayed on occupied :${blockedPort} (${host}:${port})`
  );
} finally {
  await new Promise((resolve) => blocker.close(resolve));
}

const [main, backendProcess, installer] = [
  "front/electron/main.cjs",
  "front/electron/backend-process.cjs",
  "scripts/karaoke-studio.iss",
].map((file) =>
  fs.readFileSync(path.join(root, file), "utf8")
);

[
  [main.includes("path.dirname(process.execPath)"), "executable root is missing"],
  [main.includes('"data"'), "data root is missing"],
  [/app\.setPath\(\s*"userData"/.test(main), "userData path is not redirected"],
  [main.includes('app.setPath("temp"'), "temp path is not redirected"],
  [
    /require\(["']\.\/backend-process\.cjs["']\)/.test(main) &&
      /require\(["']\.\/backend-endpoint\.cjs["']\)/.test(backendProcess) &&
      /chooseRuntimeBackendEndpoint\s*\(/.test(backendProcess),
    "dynamic backend endpoint is not connected to Electron startup",
  ],
  [/^PrivilegesRequired=lowest$/m.test(installer), "installer requires elevation"],
  [
    /^DefaultDirName=\{code:GetDefaultDir\}$/m.test(installer),
    "default-directory resolver is not used"
  ],
  [
    /Result\s*:=\s*ExpandConstant\('\{userdocs\}\\\{#MyAppName\}'\);/.test(installer),
    "user-documents fallback is missing"
  ],
  [
    !/\{(?:localappdata|userappdata)\}\\A&D Voice/.test(installer),
    "runtime data is written outside {app}"
  ],
  ...["backend", "models", "logs"].map((name) => {
    const expected = `{app}\\data\\${name}`;
    return [installer.includes(expected), `missing self-contained installer path: ${expected}`];
  }),
  [
    /path\.join\(INSTALL_DATA_ROOT,\s*["']cache["']\)/.test(backendProcess),
    "backend cache is not rooted inside the installation data directory",
  ],
  [
    installer.includes("{app}\\.install\\app-runtime.zip"),
    "missing self-contained runtime archive path",
  ],
].forEach(([ok, message]) => check(ok, message));
