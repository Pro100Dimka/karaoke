const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const { installBackendFileAuthentication } = require(path.resolve(__dirname, "../../electron/backend-media-auth.cjs"));

const backendBase = process.env.ADVOICE_E2E_BACKEND;
const token = process.env.ADVOICE_E2E_TOKEN;
const lightingTest = process.env.ADVOICE_E2E_LIGHTING === "1";
if (!backendBase || !token) throw new Error("Missing Electron release E2E environment");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Electron 30+ rejects --remote-debugging-port on the raw CLI (playwright's
// electron.launch() no longer works around this: microsoft/playwright#39008),
// so the switch is set here instead. Chromium still logs the same
// "DevTools listening on ws://..." line playwright waits for.
app.commandLine.appendSwitch("remote-debugging-port", "0");

app.whenReady().then(async () => {
  if (lightingTest && process.platform === "win32") {
    const bridge = require(
      process.env.ADVOICE_E2E_LIGHTING_MODULE || path.resolve(__dirname, "../../../generated/build/lighting/KeyboardLighting.node")
    );
    app.lightingProbe = await bridge.request(0);
    await bridge.request(2);
    app.usbLightingProbe = await bridge.usbRequest(0);
    await bridge.usbRequest(2);
  }
  installBackendFileAuthentication(session.defaultSession.webRequest, backendBase, token);
  const window = new BrowserWindow({
    show: !lightingTest,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (lightingTest) window.webContents.setAudioMuted(true);
  const src = `${backendBase}/songs/release-song/audio/instrumental`;
  const lightingSource = lightingTest
    ? fs.readFileSync(path.resolve(__dirname, "../../src/services/keyboardLighting.js"), "utf8").replaceAll("export ", "")
    : "";
  const html = `<!doctype html><meta charset="utf-8"><div id="status">boot</div><audio id="a" crossorigin="anonymous" preload="auto" src="${src}"></audio><script>
    ${lightingSource}
    const a = document.getElementById('a');
    const status = document.getElementById('status');
    a.addEventListener('loadeddata', async () => {
      status.textContent = 'loaded';
      try { await a.play(); status.textContent = 'playing'; } catch (e) { status.textContent = 'play-error:' + e.name; }
      ${lightingTest ? "window.stopLighting = observeLightingMedia(a); window.readLighting = readLightingMusic;" : ""}
    });
    a.addEventListener('error', () => status.textContent = 'media-error:' + (a.error?.code ?? 'unknown'));
  <\/script>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
});

app.on("window-all-closed", () => app.quit());
