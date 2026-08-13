import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SIGNALING_URL,
  OnlineRoomClient
} from "../src/services/onlineRoom.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("production CSP allows the online room WebSocket", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes(DEFAULT_SIGNALING_URL));
});

test("room connection reports a useful close reason", async () => {
  const originalWebSocket = globalThis.WebSocket;
  class ClosedSocket {
    static CLOSING = 2;

    constructor() {
      this.readyState = ClosedSocket.CLOSING;
      queueMicrotask(() => this.onclose?.({ code: 1006, reason: "" }));
    }
  }
  globalThis.WebSocket = ClosedSocket;
  try {
    await assert.rejects(
      new OnlineRoomClient().connect({ id: "ROOM1234", name: "Test" }),
      /VPN, прокси или брандмауэр/
    );
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
