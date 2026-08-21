import assert from "node:assert/strict";
import test from "node:test";

import { handleLogUpload, KaraokeRoom } from "../src/worker.js";

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

class FakeR2 {
  constructor() {
    this.objects = new Map();
  }

  async get(key) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }

  async put(key, value) {
    this.objects.set(key, value);
  }

  async list({ prefix }) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
      truncated: false,
    };
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
}

const logRequest = (payload) =>
  new Request("https://worker.test/logs", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" },
    body: JSON.stringify(payload),
  });

test("keeps one root log object per device and appends only warnings and errors", async () => {
  const bucket = new FakeR2();
  bucket.objects.set("logs/legacy/old.log", "old");
  const base = {
    device_id: "pc-abcdef123456",
    display_name: "Studio PC",
    hardware: { cpu: "Test CPU", settings: { thread_count: 8 } },
    events: [
      { timestamp: "2026-08-21T10:00:00Z", level: "WARNING", message: "first" },
      { timestamp: "2026-08-21T10:00:01Z", level: "INFO", message: "discard me" },
    ],
  };
  let response = await handleLogUpload(logRequest(base), { LOGS: bucket });
  assert.equal(response.status, 200);
  response = await handleLogUpload(
    logRequest({
      device_id: base.device_id,
      events: [{ timestamp: "2026-08-21T10:01:00Z", level: "ERROR", message: "second" }],
    }),
    { LOGS: bucket }
  );
  assert.equal(response.status, 200);
  assert.deepEqual([...bucket.objects.keys()], ["pc-abcdef123456.json"]);
  const stored = JSON.parse(bucket.objects.get("pc-abcdef123456.json"));
  assert.deepEqual(stored.events.map(({ level, message }) => [level, message]), [
    ["WARNING", "first"],
    ["ERROR", "second"],
  ]);
  assert.equal(stored.hardware.settings.thread_count, 8);
});

test("rejects batches without hardware, warnings or errors", async () => {
  const response = await handleLogUpload(
    logRequest({
      device_id: "pc-abcdef123456",
      events: [{ level: "INFO", message: "noise" }],
    }),
    { LOGS: new FakeR2() }
  );
  assert.equal(response.status, 400);
});
