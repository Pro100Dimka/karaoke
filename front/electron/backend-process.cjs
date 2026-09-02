const { spawn } = require("child_process");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { chooseRuntimeBackendEndpoint } = require("./backend-endpoint.cjs");
const {
  BACKEND_HOST,
  BACKEND_PORT,
  BACKEND_REQUEST_TIMEOUT_MS,
  BACKEND_RESTART_BASE_DELAY_MS,
  BACKEND_RESTART_MAX_DELAY_MS,
  BACKEND_STOP_GRACE_MS,
  BACKEND_URL
} = require("./runtime-config.cjs");

const BACKEND_ALREADY_RUNNING_EXIT_CODE = 23;
function createBackendProcess({
  isDev,
  INSTALL_DATA_ROOT,
  INSTALL_ROOT,
  INSTALL_LOG_DIR,
  IS_WINDOWS,
  isQuitting,
  recordStartupMilestone
}) {
  let backendProcess = null;

  let backendRestartTimer = null;
  let backendStopRequested = false;
  let backendStopPromise = null;
  let backendRestartAttempts = 0;
  let backendStableTimer = null;
  let backendHealthTimer = null;
  let backendHealthFailures = 0;
  let backendDuplicateWatchTimer = null;
  let backendDuplicateDetected = false;
  let backendDuplicateWatchGeneration = 0;
  const BACKEND_STABLE_RESET_MS = 30_000;
  const BACKEND_DUPLICATE_WATCH_MS = 5_000;
  const BACKEND_API_TOKEN =
    process.env.SONGAPP_API_TOKEN || crypto.randomBytes(32).toString("base64url");
  let runtimeBackendUrl = BACKEND_URL;
  let runtimeBackendHost = BACKEND_HOST;
  let runtimeBackendPort = BACKEND_PORT;

  async function configureRuntimeBackendEndpoint() {
    const endpoint = await chooseRuntimeBackendEndpoint({
      isDev,
      explicitUrl: process.env.KARAOKE_BACKEND_URL,
      defaultUrl: BACKEND_URL
    });
    runtimeBackendUrl = endpoint.url;
    runtimeBackendHost = endpoint.host;
    runtimeBackendPort = endpoint.port;
  }

  function packagedBackendDataDir() {
    return isDev ? null : path.join(INSTALL_DATA_ROOT, "backend");
  }

  function resolvePackagedBackendDataDir() {
    return packagedBackendDataDir();
  }

  function resolveBackendDir() {
    // В dev-режиме backend лежит рядом с проектом (../backend при обычной
    // раскладке репозитория). В собранном приложении ожидаем, что backend
    // упакован рядом с ресурсами — см. README.md о сборке инсталлятора:
    // это то место, которое нужно донастроить под конкретный способ
    // распространения (PyInstaller-бинарник backend'а и т.п.).
    if (isDev) return path.resolve(__dirname, "..", "..", "backend");
    return path.join(process.resourcesPath, "backend");
  }

  function requestBackendJson(pathname, timeoutMs = BACKEND_REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const request = http.get(
        `${runtimeBackendUrl}${pathname}`,
        { headers: { "X-ADVoice-Token": BACKEND_API_TOKEN } },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            if (body.length < 1024 * 1024) body += chunk;
          });
          response.on("end", () => {
            if (response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error(`Backend returned HTTP ${response.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(body));
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error("Backend request timed out"));
      });
      request.on("error", reject);
    });
  }

  // Folds Electron main-process errors into the same application.log file the
  // Python backend and renderer already report to, instead of leaving them
  // only in this process's own stdout. Best-effort: the backend is not always
  // reachable when these fire (e.g. the backend itself failed to start), so
  // failures here are swallowed rather than compounding the original error.
  function reportBackendError(message, stack) {
    try {
      const body = JSON.stringify({ source: "electron-main", level: "error", message, stack });
      const request = http.request(
        `${runtimeBackendUrl}/diagnostics/client-log`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-ADVoice-Token": BACKEND_API_TOKEN,
            "Content-Length": Buffer.byteLength(body)
          },
          timeout: 2000
        },
        (response) => response.resume()
      );
      request.on("error", () => {});
      request.on("timeout", () => request.destroy());
      request.end(body);
    } catch {
      // Never let error reporting itself throw.
    }
  }

  async function resolveSongOutputDir() {
    try {
      const settings = await requestBackendJson("/settings");
      const configuredPath = settings?.songs_folder;
      if (typeof configuredPath === "string" && configuredPath.trim()) {
        return path.resolve(configuredPath.trim());
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "Не удалось получить папку библиотеки от backend, используется путь по умолчанию:",
        error?.message || error
      );
    }

    if (isDev) return path.resolve(resolveBackendDir(), "..", "karaoke_songs");
    return path.join(resolvePackagedBackendDataDir(), "karaoke_songs");
  }

  function scheduleBackendRestart() {
    if (
      isQuitting() ||
      backendStopRequested ||
      backendDuplicateDetected ||
      process.env.KARAOKE_BACKEND_EXTERNAL === "1"
    ) {
      return;
    }

    clearTimeout(backendRestartTimer);
    const delay = Math.min(
      BACKEND_RESTART_MAX_DELAY_MS,
      BACKEND_RESTART_BASE_DELAY_MS * 2 ** Math.min(backendRestartAttempts, 5)
    );
    backendRestartAttempts += 1;
    backendRestartTimer = setTimeout(startBackend, delay);
  }

  function watchDuplicateBackend() {
    backendDuplicateDetected = true;
    const generation = ++backendDuplicateWatchGeneration;
    clearTimeout(backendDuplicateWatchTimer);
    const active = () =>
      generation === backendDuplicateWatchGeneration &&
      !isQuitting() &&
      !backendStopRequested &&
      backendDuplicateDetected;
    const check = async () => {
      if (!active()) return;
      try {
        await requestBackendJson("/settings", Math.min(BACKEND_REQUEST_TIMEOUT_MS, 3000));
        if (active()) backendDuplicateWatchTimer = setTimeout(check, BACKEND_DUPLICATE_WATCH_MS);
      } catch {
        if (!active()) return;
        backendDuplicateDetected = false;
        backendDuplicateWatchTimer = null;
        startBackend();
      }
    };
    backendDuplicateWatchTimer = setTimeout(check, BACKEND_DUPLICATE_WATCH_MS);
  }

  function startBackend() {
    if (
      isQuitting() ||
      backendStopRequested ||
      process.env.KARAOKE_BACKEND_EXTERNAL === "1" ||
      (backendProcess && !backendProcess.killed)
    ) {
      return;
    }
    clearTimeout(backendRestartTimer);
    backendRestartTimer = null;
    backendStopRequested = false;
    const backendDir = resolveBackendDir();
    const backendCommand = isDev
      ? process.env.KARAOKE_PYTHON || (IS_WINDOWS ? "python" : "python3")
      : path.join(backendDir, IS_WINDOWS ? "KaraokeBackend.exe" : "KaraokeBackend");
    const backendArgs = isDev ? ["run.py"] : [];
    const backendDataDir = isDev ? null : resolvePackagedBackendDataDir();
    const backendLogDir = isDev
      ? path.resolve(__dirname, "..", "..", "generated", "logs")
      : INSTALL_LOG_DIR;
    const packagedModelsDir = isDev ? null : path.join(INSTALL_DATA_ROOT, "models");
    const packagedCacheDir = isDev ? null : path.join(INSTALL_DATA_ROOT, "cache");
    const packagedDownloadsDir = isDev ? null : path.join(INSTALL_DATA_ROOT, "downloads");

    try {
      const childProcess = spawn(backendCommand, backendArgs, {
        cwd: backendDir,
        // run.py already writes backend, renderer and Electron diagnostics to
        // application.log; redirecting the child created a duplicate log stream.
        stdio: isDev ? "inherit" : "ignore",
        windowsHide: true,
        env: {
          ...process.env,
          ...(backendDataDir
            ? {
                SONGAPP_INSTALL_ROOT: INSTALL_ROOT,
                SONGAPP_DATA_DIR: backendDataDir,
                SONGAPP_MODELS_DIR: packagedModelsDir,
                SONGAPP_CACHE_DIR: packagedCacheDir,
                SONGAPP_DOWNLOADS_DIR: packagedDownloadsDir,
                HF_HOME: path.join(packagedCacheDir, "huggingface"),
                HF_HUB_CACHE: path.join(packagedCacheDir, "huggingface", "hub"),
                TORCH_HOME: path.join(packagedCacheDir, "torch"),
                NUMBA_CACHE_DIR: path.join(packagedCacheDir, "numba"),
                MPLCONFIGDIR: path.join(packagedCacheDir, "matplotlib")
              }
            : {}),
          SONGAPP_HOST: runtimeBackendHost,
          SONGAPP_PORT: String(runtimeBackendPort),
          SONGAPP_LOG_DIR: backendLogDir,
          SONGAPP_API_TOKEN: BACKEND_API_TOKEN,
          ...(isDev ? {} : { SONGAPP_CORS_ORIGINS: "null" }),
          // Packaged ffmpeg.exe is placed next to KaraokeBackend.exe.
          PATH: `${backendDir}${path.delimiter}${process.env.PATH || ""}`
        }
      });
      backendProcess = childProcess;
      childProcess.once("spawn", () => {
        recordStartupMilestone("backend-spawn");
        clearTimeout(backendStableTimer);
        backendStableTimer = setTimeout(() => {
          if (backendProcess === childProcess) backendRestartAttempts = 0;
        }, BACKEND_STABLE_RESET_MS);
        clearInterval(backendHealthTimer);
        backendHealthFailures = 0;
        backendHealthTimer = setInterval(async () => {
          if (backendProcess !== childProcess || backendStopRequested || isQuitting()) return;
          try {
            await requestBackendJson("/diagnostics/health", 3000);
            backendHealthFailures = 0;
          } catch (error) {
            backendHealthFailures += 1;
            if (backendHealthFailures < 3 || backendProcess !== childProcess) return;
            const message = "Backend health check failed three times; restarting";
            console.error(message, error?.stack || error);
            reportBackendError(message, error?.stack || String(error));
            childProcess.kill();
          }
        }, 10_000);
        backendHealthTimer.unref?.();
      });
      childProcess.on("error", (err) => {
        clearInterval(backendHealthTimer);
        backendHealthTimer = null;
        clearTimeout(backendStableTimer);
        backendStableTimer = null;
        console.error("Не удалось запустить backend:", err);
        reportBackendError("Не удалось запустить backend", err?.stack || String(err));
        if (backendProcess === childProcess) backendProcess = null;
        scheduleBackendRestart();
      });
      childProcess.on("exit", (code, signal) => {
        clearInterval(backendHealthTimer);
        backendHealthTimer = null;
        clearTimeout(backendStableTimer);
        backendStableTimer = null;
        if (backendProcess === childProcess) backendProcess = null;
        if (code === BACKEND_ALREADY_RUNNING_EXIT_CODE) {
          // Another healthy backend owns the port. Watch it instead of either
          // restart-looping or disabling self-healing for the whole app lifetime.
          watchDuplicateBackend();
          return;
        }
        if (isQuitting() || backendStopRequested || process.env.KARAOKE_BACKEND_EXTERNAL === "1") {
          return;
        }
        const message = `Backend stopped (${code ?? "unknown"}, ${signal ?? "no signal"}); restarting…`;
        console.error(message);
        reportBackendError(message);
        scheduleBackendRestart();
      });
    } catch (err) {
      backendProcess = null;
      console.error("Не удалось запустить backend:", err);
      reportBackendError("Не удалось запустить backend", err?.stack || String(err));
      scheduleBackendRestart();
    }
  }

  function stopBackend() {
    if (backendStopRequested) return backendStopPromise;
    backendStopRequested = true;
    let resolveStopPromise;
    backendStopPromise = new Promise((resolve) => {
      resolveStopPromise = resolve;
    });
    clearTimeout(backendRestartTimer);
    clearTimeout(backendStableTimer);
    clearTimeout(backendDuplicateWatchTimer);
    clearInterval(backendHealthTimer);
    backendStableTimer = null;
    backendDuplicateWatchTimer = null;
    backendHealthTimer = null;
    backendDuplicateDetected = false;
    backendDuplicateWatchGeneration += 1;

    const terminateBackend = () => {
      const process_ = backendProcess;
      backendProcess = null;
      if (!process_) return;
      const { pid } = process_;
      // Don't gate on process_.killed: the health-check watchdog can also
      // call childProcess.kill() on this same object (a plain soft kill) and
      // win the race to flip that flag first. Always dispatch the tree-kill
      // below regardless -- stopBackend() already guarantees this runs at
      // most once, so there's no risk of double-killing.
      if (!process_.killed) process_.kill();
      if (IS_WINDOWS && pid) {
        // PyInstaller/native workers can outlive a soft child kill; terminate
        // the whole process tree on app shutdown.
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
        // An unhandled 'error' event (missing/blocked taskkill.exe) would
        // otherwise throw and crash the whole main process mid-shutdown.
        killer.on("error", () => {});
      }
    };

    // Ask any in-progress AI processing to cancel cooperatively before the
    // grace period below force-kills the process tree, so it has a chance to
    // reach a clean cancelled state instead of being cut off mid-write.
    // Best-effort/fire-and-forget: doesn't gate the shutdown timeline below.
    const shutdownRequest = http.request(`${runtimeBackendUrl}/diagnostics/shutdown`, {
      method: "POST",
      timeout: 450,
      headers: { "X-ADVoice-Token": BACKEND_API_TOKEN }
    });
    shutdownRequest.on("response", (response) => response.resume());
    shutdownRequest.on("error", () => {});
    shutdownRequest.on("timeout", () => shutdownRequest.destroy());
    shutdownRequest.end();

    // Release the native audio worker before terminating Python. On Windows a
    // direct child-process kill can otherwise leave an isolated monitor holding
    // the microphone for a short time after the application has closed.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      terminateBackend();
      resolveStopPromise();
    };
    const request = http.request(`${runtimeBackendUrl}/audio/direct-monitor/stop`, {
      method: "POST",
      timeout: 450,
      headers: { "X-ADVoice-Token": BACKEND_API_TOKEN }
    });
    request.on("response", (response) => {
      response.resume();
      response.once("end", finish);
    });
    request.on("error", finish);
    request.on("timeout", () => {
      request.destroy();
      finish();
    });
    request.end();
    setTimeout(finish, BACKEND_STOP_GRACE_MS);
    return backendStopPromise;
  }

  return {
    configureRuntimeBackendEndpoint,
    resolveSongOutputDir,
    startBackend,
    stopBackend,
    reportBackendError,
    get url() {
      return runtimeBackendUrl;
    },
    get apiToken() {
      return BACKEND_API_TOKEN;
    }
  };
}
module.exports = { createBackendProcess, BACKEND_ALREADY_RUNNING_EXIT_CODE };
