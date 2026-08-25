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

test("stores a plain-text log message under a sanitized per-user key", async () => {
  const bucket = new FakeR2();
  const response = await handleLogUpload(
    logRequest({ user: "Studio PC", message: "something went wrong" }),
    { LOGS: bucket }
  );
  assert.equal(response.status, 200);
  const [key] = [...bucket.objects.keys()];
  assert.match(key, /^logs\/Studio PC\/.+\.log$/);
  assert.equal(bucket.objects.get(key), "something went wrong");
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

test("marks the departure broadcast as wasHost when the host disconnects, but not for a guest", async () => {
  const host = new FakeSocket({ id: "host", name: "Host", role: "host", micMuted: false });
  const guest = new FakeSocket({ id: "guest", name: "Guest", role: "guest", micMuted: false });
  const room = new KaraokeRoom({ getWebSockets: () => [guest] });

  await room.webSocketClose(host, 1000, "gone");

  assert.deepEqual(guest.messages.at(-1), {
    type: "participant-left",
    participantId: "host",
    wasHost: true,
  });

  const secondGuest = new FakeSocket({ id: "guest-2", name: "Guest 2", role: "guest", micMuted: false });
  const roomAfterGuestLeaves = new KaraokeRoom({ getWebSockets: () => [secondGuest] });

  await roomAfterGuestLeaves.webSocketClose(guest, 1000, "gone");

  assert.deepEqual(secondGuest.messages.at(-1), {
    type: "participant-left",
    participantId: "guest",
    wasHost: false,
  });
});

test("host can broadcast shared library filters including sort", async () => {
  const sender = new FakeSocket({ id: "sender", role: "host" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });
  const filters = { genre: "Rock", key: "Am", status: "done", sort: "artist" };

  await room.webSocketMessage(sender, JSON.stringify({ type: "ui", state: { filters } }));

  assert.equal(sender.closed, null);
  assert.deepEqual(target.messages.at(-1), {
    type: "ui",
    fromId: "sender",
    state: { filters },
  });
});

test("host can broadcast all shared karaoke preferences", async () => {
  const sender = new FakeSocket({ id: "sender", role: "host" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });
  const karaoke = {
    musicVolume: 0.21,
    vocalVolume: 0.42,
    melodyVolume: 0.63,
    speed: 1.25,
    keyShift: -3,
    showLyrics: false,
    showNotes: false,
    autoHideConsole: false,
    effectPreset: "studio",
  };

  await room.webSocketMessage(sender, JSON.stringify({ type: "ui", state: { karaoke } }));

  assert.equal(sender.closed, null);
  assert.deepEqual(target.messages.at(-1), {
    type: "ui",
    fromId: "sender",
    state: { karaoke },
  });
});

test("a guest cannot broadcast host-only state like library filters or karaoke preferences", async () => {
  const sender = new FakeSocket({ id: "sender", role: "guest" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "ui", state: { filters: { genre: "Rock" } } })
  );

  assert.deepEqual(sender.closed, { code: 1008, reason: "Некорректное сообщение комнаты." });
  assert.equal(target.messages.length, 0);
});

test("any participant can broadcast their own effects and shared library songs", async () => {
  const sender = new FakeSocket({ id: "sender", role: "guest" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });
  const participantEffects = { dry: 0.5, wet: 0.5 };
  const songs = [{ id: "song-1", title: "Song" }];

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "ui", state: { participantEffects, songs } })
  );

  assert.equal(sender.closed, null);
  assert.deepEqual(target.messages.at(-1), {
    type: "ui",
    fromId: "sender",
    state: { participantEffects, songs },
  });
});
