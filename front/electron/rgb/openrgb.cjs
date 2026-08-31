const net = require("node:net");
const {
  VERSION,
  MAX_PACKET,
  uint32,
  packet,
  parseController,
  colorBody,
  modeBody
} = require("./protocol.cjs");

// Automatic-save modes may write device flash on each update: never animate them.
const supportsRealtime = (device) =>
  device.type === 5 &&
  device.colorCount > 0 &&
  device.modes.some((mode) => mode.name.toLowerCase() === "direct" && !(mode.flags & (1 << 9)));

class OpenRgb {
  constructor(connect = net.createConnection) {
    this.connect = connect;
    this.devices = [];
    this.socket = null;
    this.pending = null;
    this.active = false;
    this.state = "disconnected";
  }

  async start() {
    this.state = "connecting";
    const socket = this.connect({ host: "127.0.0.1", port: 6742 });
    this.socket = socket;
    let buffer = Buffer.alloc(0);
    socket.setNoDelay(true);
    const fail = (error) => {
      this.state = "disconnected";
      this.pending?.reject(error);
      this.pending = null;
      socket.destroy();
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("OpenRGB disconnected")));
    socket.on("data", (chunk) => {
      try {
        if (buffer.length + chunk.length > MAX_PACKET + 16) throw new Error("RGB packet too large");
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 16) {
          if (buffer.toString("ascii", 0, 4) !== "ORGB") throw new Error("Invalid RGB header");
          const size = buffer.readUInt32LE(12);
          if (size > MAX_PACKET) throw new Error("RGB packet too large");
          if (buffer.length < 16 + size) break;
          const id = buffer.readUInt32LE(8),
            device = buffer.readUInt32LE(4),
            body = buffer.subarray(16, 16 + size);
          buffer = buffer.subarray(16 + size);
          // Old protocol uses indexed device IDs: never write after topology changes.
          if (id === 100) throw new Error("RGB devices changed");
          if (this.pending?.id === id && this.pending.device === device) {
            const { pending } = this;
            this.pending = null;
            pending.resolve(body);
          }
        }
      } catch (error) {
        console.error("OpenRGB packet handling failed", error?.stack || error);
        fail(error);
      }
    });
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("RGB connection timeout"));
          socket.destroy();
        }, 1200);
        socket.once("connect", () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        socket.once("close", () => {
          clearTimeout(timeout);
          reject(new Error("RGB closed"));
        });
      });
      const version = await this.request(40, 0, uint32(VERSION));
      if (version.length !== 4 || version.readUInt32LE() < VERSION)
        throw new Error("Unsupported OpenRGB version");
      this.send(50, 0, Buffer.from("A&D Voice\0"));
      const count = await this.request(0);
      if (count.length !== 4 || count.readUInt32LE() > 128)
        throw new Error("Invalid RGB device count");
      this.devices = [];
      let keyboards = 0;
      for (let id = 0; id < count.readUInt32LE(); id++) {
        const device = parseController(await this.request(1, id, uint32(VERSION)), id);
        if (device.type === 5) keyboards++;
        if (supportsRealtime(device)) this.devices.push(device);
      }
      this.state = this.devices.length ? "ready" : keyboards ? "unsupported" : "no_devices";
      return this.devices.map(({ name }) => name);
    } catch (error) {
      console.error("OpenRGB connection failed", error?.stack || error);
      fail(error);
      throw error;
    }
  }

  request(id, device = 0, body = Buffer.alloc(0)) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = null;
        reject(new Error("RGB request timeout"));
        this.socket.destroy();
      }, 1500);
      this.pending = {
        id,
        device,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      };
      this.send(id, device, body);
    });
  }

  send(id, device, body) {
    if (!this.socket || this.socket.destroyed) return false;
    return this.socket.write(packet(id, device, body));
  }

  frame(rgb) {
    if (this.state !== "ready" || this.socket.writableLength > 65536) return;
    if (!this.active) {
      for (const d of this.devices) this.send(1100, d.id);
      this.active = true;
    }
    for (const d of this.devices) {
      const [red, green, blue] = rgb;
      const colors = Buffer.alloc(d.colorCount * 4);
      for (let i = 0; i < colors.length; i += 4) {
        colors[i] = red;
        colors[i + 1] = green;
        colors[i + 2] = blue;
      }
      this.send(1050, d.id, colorBody(colors));
    }
  }

  release() {
    if (!this.active || this.state !== "ready") return;
    for (const d of this.devices) {
      this.send(1050, d.id, colorBody(d.colors));
      this.send(1101, d.id, modeBody(d.activeMode, d.modes[d.activeMode].raw));
    }
    this.active = false;
  }

  stop() {
    this.release();
    this.socket?.end();
    const { socket } = this;
    const timer = setTimeout(() => socket?.destroy(), 250);
    timer.unref?.();
    this.state = "disconnected";
  }
}
module.exports = { OpenRgb, supportsRealtime };
