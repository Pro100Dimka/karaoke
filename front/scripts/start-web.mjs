import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const front = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.resolve(front, "../backend");
const healthUrl = "http://127.0.0.1:8000/diagnostics/health";
const viteEntry = path.join(front, "node_modules/vite/bin/vite.js");
const bundledPython = path.join(backend, "venv/Scripts/python.exe");

const healthy = async () => {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
};

const waitForBackend = async (child) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await healthy()) return;
    if (child.exitCode != null) {
      throw new Error(`Backend stopped before becoming ready (exit ${child.exitCode})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Backend did not become ready within 60 seconds: ${healthUrl}`);
};

let backendProcess = null;
if (!(await healthy())) {
  const python =
    process.env.KARAOKE_PYTHON || (existsSync(bundledPython) ? bundledPython : "python");
  backendProcess = spawn(python, ["run.py"], {
    cwd: backend,
    env: process.env,
    stdio: "inherit"
  });
  await waitForBackend(backendProcess);
  console.log(`Backend ready: ${healthUrl}`);
} else {
  console.log(`Using the backend that is already running: ${healthUrl}`);
}

const viteArguments = [viteEntry];
if (process.env.KARAOKE_WEB_OPEN !== "0") viteArguments.push("--open");
const vite = spawn(process.execPath, viteArguments, {
  cwd: front,
  env: { ...process.env, VITE_USE_MOCK_API: "false" },
  stdio: "inherit"
});

const shutdown = (signal) => {
  if (vite.exitCode == null) vite.kill(signal);
  if (backendProcess?.exitCode == null) backendProcess.kill(signal);
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(signal));
}

vite.on("exit", (code) => {
  if (backendProcess?.exitCode == null) backendProcess.kill();
  process.exitCode = code ?? 0;
});
