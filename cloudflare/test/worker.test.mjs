import assert from "node:assert/strict";
import test from "node:test";

import { KaraokeRoom } from "../src/worker.js";

class FakeSocket {
  constructor(participant) {
    this.participant = participant;
    this.messages = [];
    this.closed = null;
  }

  deserializeAttachment() {
    return this.participant;
  }

  send(message) {
    this.messages.push(JSON.parse(message));
  }

  close(code, reason) {
    this.closed = { code, reason };
  }
}

test("rejects signaling payloads by UTF-8 byte size", async () => {
  const sender = new FakeSocket({ id: "sender", role: "guest" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "signal", targetId: "target", signal: "я".repeat(33_000) })
  );

  assert.equal(target.messages.length, 0);
  assert.deepEqual(sender.closed, { code: 1008, reason: "Signal too large" });
});
