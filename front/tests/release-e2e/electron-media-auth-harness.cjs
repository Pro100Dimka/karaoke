const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");

const { installBackendFileAuthentication } = require(path.resolve(__dirname, "../../electron/backend-media-auth.cjs"));

const backendBase = process.env.ADVOICE_E2E_BACKEND;
const token = process.env.ADVOICE_E2E_TOKEN;
if (!backendBase || !token) throw new Error("Missing Electron release E2E environment");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(async () => {
  installBackendFileAuthentication(session.defaultSession.webRequest, backendBase, token);
  const window = new BrowserWindow({
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const src = `${backendBase}/songs/release-song/audio/instrumental`;
  const html = `<!doctype html><meta charset="utf-8"><div id="status">boot</div><audio id="a" preload="auto" src="${src}"></audio><script>
    const a = document.getElementById('a');
    const status = document.getElementById('status');
    a.addEventListener('loadeddata', async () => {
      status.textContent = 'loaded';
      try { await a.play(); status.textContent = 'playing'; } catch (e) { status.textContent = 'play-error:' + e.name; }
    });
    a.addEventListener('error', () => status.textContent = 'media-error:' + (a.error?.code ?? 'unknown'));
  <\/script>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
});

app.on("window-all-closed", () => app.quit());
