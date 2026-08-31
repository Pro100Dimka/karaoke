const fs = require("node:fs");
const path = require("node:path");
const { OpenRgb } = require("./openrgb.cjs");

function loadWindows(resourcesPath) {
  if (process.platform !== "win32") return null;
  const filename = resourcesPath
    ? path.join(resourcesPath, "lighting", "KeyboardLighting.node")
    : path.resolve(__dirname, "../../../generated/build/lighting/KeyboardLighting.node");
  try { if (fs.existsSync(filename)) return require(filename); } catch { /* Optional unsupported OS/API. */ }
  return null;
}
class LightingController {
  constructor({ windows = null, openrgb = () => new OpenRgb(), now = Date.now } = {}) {
    this.windows = windows; this.openrgb = openrgb; this.now = now;
    this.enabled = false; this.provider = null; this.busy = false;
    this.generation = 0; this.lastFrame = 0; this.lastInput = 0;
    this.status = { state: "disabled", count: 0 };
    this.configQueue = Promise.resolve();
    this.watchdog = setInterval(() => {
      if (this.provider && this.now() - this.lastInput > 2000) this.release();
    }, 1000);
    this.watchdog.unref?.();
  }
  configure(enabled) {
    if (typeof enabled !== "boolean") throw new Error("Invalid lighting setting");
    const token = ++this.generation;
    this.enabled = enabled;
    this.configQueue = this.configQueue.catch(() => {}).then(() => this.applyConfiguration(enabled, token));
    return this.configQueue;
  }
  async applyConfiguration(enabled, token) {
    if (token !== this.generation) return this.status;
    await this.release();
    this.status = { state: enabled ? "connecting" : "disabled", count: 0 };
    if (!enabled || token !== this.generation) return this.status;
    if (this.windows?.request) {
      const status = await this.windows.request(0).catch(() => ({ state: "unavailable" }));
      if (token !== this.generation) { await this.windows.request(2); return this.status; }
      if (status.count > 0 && status.state === "ready") {
        this.provider = "windows"; this.lastInput = this.now();
        this.status = { ...status, provider: "windows" }; return this.status;
      }
      await this.windows.request(2).catch(() => {});
    }
    const client = this.openrgb();
    try {
      const names = await client.start();
      if (token !== this.generation) { client.stop(); return this.status; }
      this.provider = client; this.lastInput = this.now();
      this.status = { state: names.length ? "ready" : "no_devices", provider: "openrgb", count: names.length };
    } catch {
      client.stop();
      if (token === this.generation) this.status = { state: "unavailable", count: 0 };
    }
    return this.status;
  }
  async frame({ rgb, active } = {}) {
    if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) || typeof active !== "boolean") return this.status;
    this.lastInput = this.now();
    if (!this.enabled || this.busy || this.now() - this.lastFrame < 45) return this.status;
    this.lastFrame = this.now();
    this.busy = true;
    let token = this.generation;
    try {
      await this.configQueue;
      if (!this.enabled || token !== this.generation) return this.status;
      if (!active) {
        this.lastRetry = 0;
        if (this.provider === "windows") await this.release();
        else this.provider?.release();
      } else {
        if (!this.provider || (this.provider !== "windows" && this.provider.state !== "ready")) {
          if (this.now() - (this.lastRetry || 0) < 5000) return this.status;
          this.lastRetry = this.now(); await this.configure(true);
          token = this.generation;
        }
        if (!this.enabled) return this.status;
        if (this.provider === "windows") {
          const status = await this.windows.request(1, ...rgb);
          if (token === this.generation) {
            this.status = { ...status, provider: "windows" };
            if (!status.count) await this.release();
          }
        }
        else this.provider?.frame(rgb);
      }
    } catch { this.status = { state: "unavailable", count: 0 }; await this.release(); }
    finally { this.busy = false; }
    return this.status;
  }
  async release() {
    const previous = this.provider; this.provider = null;
    if (previous === "windows") await this.windows.request(2).catch(() => {});
    else previous?.stop();
  }
  async close() { clearInterval(this.watchdog); await this.configure(false); }
}
module.exports = { LightingController, loadWindows };
