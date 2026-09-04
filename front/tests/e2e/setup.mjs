import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontRoot = path.resolve(here, "../..");
const projectRoot = path.resolve(frontRoot, "..");
const backendRoot = path.join(projectRoot, "backend");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForBackend(url, token, process) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Real E2E backend exited with code ${process.exitCode}`);
    try {
      const response = await fetch(`${url}/diagnostics/health`, {
        headers: { "X-ADVoice-Token": token }
      });
      if (response.ok) return;
    } catch {
      // The process is still importing the application or binding the port.
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for real E2E backend at ${url}`);
}

async function stopBackend(process, url, token) {
  if (!process || process.exitCode !== null) return;
  try {
    await fetch(`${url}/diagnostics/shutdown`, {
      method: "POST",
      headers: { "X-ADVoice-Token": token }
    });
  } catch {
    // The exact child process is still terminated below if graceful shutdown failed.
  }
  process.kill();
  await Promise.race([
    new Promise((resolve) => process.once("exit", resolve)),
    wait(5_000)
  ]);
}

export default async function setup() {
  const previousMockApi = process.env.VITE_USE_MOCK_API;
  if (previousMockApi === undefined) process.env.VITE_USE_MOCK_API = "true";
  const realBackend = process.env.VITE_USE_MOCK_API === "false";
  let backendProcess;
  let backendUrl;
  let backendToken;

  if (realBackend) {
    const python = path.join(backendRoot, "venv", "Scripts", "python.exe");
    if (!existsSync(python)) throw new Error(`Real E2E requires the backend venv: ${python}`);
    const port = process.env.ADVOICE_E2E_BACKEND_PORT || "18001";
    backendUrl = `http://127.0.0.1:${port}`;
    backendToken = process.env.ADVOICE_E2E_TOKEN || "advoice-real-e2e";
    const testRoot = path.join(projectRoot, "generated", "tests", "real-backend-e2e");
    const backendEnvironment = {
      ...process.env,
      PYTHONPATH: backendRoot,
      SONGAPP_HOST: "127.0.0.1",
      SONGAPP_PORT: port,
      SONGAPP_API_TOKEN: backendToken,
      SONGAPP_CORS_ORIGINS: "http://127.0.0.1:4173",
      SONGAPP_DATA_DIR: path.join(testRoot, "data"),
      SONGAPP_CACHE_DIR: path.join(testRoot, "cache"),
      SONGAPP_LOG_DIR: path.join(testRoot, "logs"),
      SONGAPP_SONG_OUTPUT_DIR: path.join(testRoot, "songs")
    };
    const fixturePath = path.join(testRoot, "real-song.karaoke.zip");
    execFileSync(python, [path.join(here, "build-real-fixture.py"), fixturePath], {
      cwd: backendRoot,
      env: backendEnvironment,
      stdio: "inherit"
    });
    process.env.ADVOICE_E2E_PACKAGE = fixturePath;
    process.env.VITE_API_BASE_URL = backendUrl;
    process.env.VITE_API_TOKEN = backendToken;
    backendProcess = spawn(python, ["run.py"], {
      cwd: backendRoot,
      env: backendEnvironment,
      stdio: "inherit",
      windowsHide: true
    });
    await waitForBackend(backendUrl, backendToken, backendProcess);
  }

  const server = await createServer({
    configFile: "vite.config.mjs",
    mode: realBackend ? "development" : "mock",
    server: { host: "127.0.0.1", port: 4173, strictPort: true }
  });

  await server.listen();
  return async () => {
    await server.close();
    await stopBackend(backendProcess, backendUrl, backendToken);
    delete process.env.ADVOICE_E2E_PACKAGE;
    if (previousMockApi === undefined) delete process.env.VITE_USE_MOCK_API;
    else process.env.VITE_USE_MOCK_API = previousMockApi;
  };
}
