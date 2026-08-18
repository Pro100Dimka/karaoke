import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import {
  DEFAULT_SIGNALING_URL,
  OnlineRoomClient,
  OnlineVoiceMesh
} from "../src/services/onlineRoom.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
test("production CSP allows the online room WebSocket", () => {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes(DEFAULT_SIGNALING_URL));
});
test("song transfer reports progress and waits for receiver import", async () => {
  const sender = new OnlineVoiceMesh({ send: () => true });
  const receiver = new OnlineVoiceMesh({ send: () => true });
  const senderChannel = { readyState: "open", bufferedAmount: 0, send: null };
  const receiverChannel = { readyState: "open", bufferedAmount: 0, send: null };
  senderChannel.send = (data) => queueMicrotask(() => receiverChannel.onmessage({ data }));
  receiverChannel.send = (data) => queueMicrotask(() => senderChannel.onmessage({ data }));
  sender.setupDataChannel("receiver", senderChannel);
  receiver.setupDataChannel("sender", receiverChannel);
  const progress = [];
  sender.onTransferProgress = ({ stage, percent }) => progress.push([stage, percent]);
  let imported = "";
  receiver.onFile = async (_id, blob) => {
    imported = await blob.text();
    return true;
  };
  await sender.sendFile("receiver", new Blob(["song-package"]), {
    kind: "song-package",
    songId: "song-1"
  });
  assert.equal(imported, "song-package");
  assert.deepEqual(progress.at(-1), ["complete", 100]);
  assert.ok(progress.some(([stage]) => stage === "sending"));
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
      (error) => error instanceof Error && error.message.includes("VPN")
    );
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
