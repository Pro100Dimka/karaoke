const fs = require("node:fs");
const path = require("node:path");
const { OpenRgb } = require("./openrgb.cjs");

function loadWindows(resourcesPath) {
  if (process.platform !== "win32") return null;
  const filename = resourcesPath
    ? path.join(resourcesPath, "lighting", "KeyboardLighting.node")
    : path.resolve(__dirname, "../../../generated/build/lighting/KeyboardLighting.node");
  try {
    // The filename is resolved only from our packaged/development build root.
    // eslint-disable-next-line import/no-dynamic-require, global-require
    if (fs.existsSync(filename)) return require(filename);
  } catch (error) {
    console.error("Native keyboard lighting failed to load", error?.stack || error);
  }
  return null;
}
class LightingController {
  constructor({ windows = null, usb = null, openrgb = () => new OpenRgb(), now = Date.now } = {}) {
    this.windows = windows;
    this.usb =
      usb || (windows?.usbRequest ? { request: (...args) => windows.usbRequest(...args) } : null);
    this.openrgb = openrgb;
    this.now = now;
    this.enabled = false;
    this.provider = null;
    this.busy = false;
    this.generation = 0;
    this.lastFrame = 0;
    this.lastInput = 0;
    this.lastOutput = null;
    this.lastRetry = 0;
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
    this.configQueue = this.configQueue
      .catch(() => {})
      .then(() => this.applyConfiguration(enabled, token));
    return this.configQueue;
  }

  async applyConfiguration(enabled, token) {
    if (token !== this.generation) return this.status;
    await this.release();
    this.status = { state: enabled ? "connecting" : "disabled", count: 0 };
    if (!enabled || token !== this.generation) return this.status;
    let nativeStatus = null;
    for (const name of ["windows", "usb"]) {
      const bridge = this[name];
      if (!bridge?.request) continue;
      const status = await bridge.request(0).catch(() => ({ state: "unavailable", count: 0 }));
      const priority = { unavailable: 0, no_devices: 1, unsupported: 2, blocked: 3 };
      if (!nativeStatus || priority[status.state] > priority[nativeStatus.state])
        nativeStatus = status;
      if (token !== this.generation) {
        await bridge.request(2).catch(() => {});
        return this.status;
      }
      if (status.count > 0 && status.state === "ready") {
        this.provider = name;
        this.lastInput = this.now();
        this.status = { ...status, provider: name };
        return this.status;
      }
      await bridge.request(2).catch(() => {});
    }
    const client = this.openrgb();
    try {
      const names = await client.start();
      if (token !== this.generation) {
        client.stop();
        return this.status;
      }
      this.provider = client;
      this.lastInput = this.now();
      this.status = {
        state: names.length
          ? "ready"
          : client.state === "unsupported"
            ? "unsupported"
            : "no_devices",
        provider: "openrgb",
        count: names.length
      };
    } catch (error) {
      console.error("Keyboard lighting connection failed", error?.stack || error);
      client.stop();
      if (token === this.generation)
        this.status = nativeStatus || { state: "unavailable", count: 0 };
    }
    return this.status;
  }

  async frame({ rgb, active } = {}) {
    if (
      !Array.isArray(rgb) ||
      rgb.length !== 3 ||
      !rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) ||
      typeof active !== "boolean"
    )
      return this.status;
    this.lastInput = this.now();
    const output = active ? rgb.join(",") : null;
    if (active && this.provider && output === this.lastOutput) return this.status;
    if (!this.enabled || this.busy || this.now() - this.lastFrame < 45) return this.status;
    this.lastFrame = this.now();
    this.busy = true;
    let token = this.generation;
    try {
      await this.configQueue;
      if (!this.enabled || token !== this.generation) return this.status;
      if (!active) {
        this.lastRetry = 0;
        if (typeof this.provider === "string") await this.release();
        else this.provider?.release();
      } else {
        if (
          !this.provider ||
          (typeof this.provider !== "string" && this.provider.state !== "ready")
        ) {
          if (this.now() - (this.lastRetry || 0) < 5000) return this.status;
          this.lastRetry = this.now();
          await this.configure(true);
          token = this.generation;
        }
        if (!this.enabled) return this.status;
        if (typeof this.provider === "string") {
          const { provider } = this;
          const status = await this[provider].request(1, ...rgb);
          if (token === this.generation) {
            this.status = { ...status, provider };
            if (status.count) this.lastOutput = output;
            else await this.release();
          }
        } else {
          this.provider?.frame(rgb);
          this.lastOutput = output;
        }
      }
    } catch (error) {
      console.error("Keyboard lighting frame failed", error?.stack || error);
      this.status = { state: "unavailable", count: 0 };
      await this.release();
    } finally {
      this.busy = false;
    }
    return this.status;
  }

  async release() {
    const previous = this.provider;
    this.provider = null;
    this.lastOutput = null;
    if (typeof previous === "string") await this[previous].request(2).catch(() => {});
    else previous?.stop();
  }

  async close() {
    clearInterval(this.watchdog);
    await this.configure(false);
  }
}
function installLightingShutdown(app, lighting) {
  let pending = false,
    finished = false;
  app.on("before-quit", (event) => {
    if (finished) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    let timer;
    // Allow native restore commands to finish before Electron unloads the addon.
    // A disconnected/unresponsive device must not prevent application exit.
    Promise.race([
      Promise.resolve().then(() => lighting.close()),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5000);
      })
    ])
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        finished = true;
        app.quit();
      });
  });
}
module.exports = { LightingController, loadWindows, installLightingShutdown };
