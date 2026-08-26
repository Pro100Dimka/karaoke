import assert from "node:assert/strict";
import test from "node:test";

import { handleLogUpload, KaraokeRoom, pruneRecentGuests, reclaimGuestId, ROOM_PROTOCOL_VERSION } from "../src/worker.js";

const joinRequest = (params = {}) => {
  const url = new URL("https://worker.test/rooms/ABCD1234");
  url.searchParams.set("v", String(ROOM_PROTOCOL_VERSION));
  url.searchParams.set("name", "Guest");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url, { headers: { Upgrade: "websocket" } });
};

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

test("fetch rejects a join attempt with a missing or wrong protocol version", async () => {
  const room = new KaraokeRoom({ getWebSockets: () => [] });

  const missing = await room.fetch(
    new Request("https://worker.test/rooms/ABCD1234?name=Guest", { headers: { Upgrade: "websocket" } })
  );
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).expected, ROOM_PROTOCOL_VERSION);

  const wrong = await room.fetch(joinRequest({ v: String(ROOM_PROTOCOL_VERSION + 1) }));
  assert.equal(wrong.status, 400);
});

test("fetch lets a correctly-versioned join proceed past the version gate", async () => {
  // A join carrying the current version must reach the *next* gate (room
  // capacity) instead of being rejected for its version -- full WS upgrade
  // isn't exercised here (that needs the Workers runtime's WebSocketPair,
  // unavailable under plain `node --test`), only that the version check
  // itself doesn't false-positive on a valid client.
  const full = Array.from({ length: 12 }, (_, index) => new FakeSocket({ id: `p${index}`, role: "guest" }));
  const room = new KaraokeRoom({ getWebSockets: () => full });

  const response = await room.fetch(joinRequest());

  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "Room is full");
});

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

test("answers a private clock probe without broadcasting it", async () => {
  const sender = new FakeSocket({ id: "sender", role: "guest" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });

  await room.webSocketMessage(sender, JSON.stringify({ type: "ping", clientTime: 1234 }));

  assert.equal(sender.messages.at(-1).type, "pong");
  assert.equal(sender.messages.at(-1).clientTime, 1234);
  assert.equal(Number.isFinite(sender.messages.at(-1).serverTime), true);
  assert.equal(target.messages.length, 0);
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

test("closes the room and disconnects every remaining guest when the host leaves", async () => {
  const host = new FakeSocket({ id: "host", name: "Host", role: "host", micMuted: false });
  const guest = new FakeSocket({ id: "guest", name: "Guest", role: "guest", micMuted: false });
  const deletedKeys = [];
  const room = new KaraokeRoom({
    getWebSockets: () => [guest],
    storage: { delete: async (key) => deletedKeys.push(key) },
  });

  await room.webSocketClose(host, 1000, "gone");

  assert.deepEqual(guest.messages.at(-1), { type: "room-closed", reason: "host-left" });
  assert.deepEqual(guest.closed, { code: 4000, reason: "Host left the room" });
  assert.deepEqual(deletedKeys, ["hostToken"]);
});

test("a guest leaving only removes them from the participant list, without closing the room", async () => {
  const guest = new FakeSocket({ id: "guest", name: "Guest", role: "guest", micMuted: false });
  const secondGuest = new FakeSocket({ id: "guest-2", name: "Guest 2", role: "guest", micMuted: false });
  const room = new KaraokeRoom({ getWebSockets: () => [secondGuest] });

  await room.webSocketClose(guest, 1000, "gone");

  assert.deepEqual(secondGuest.messages.at(-1), { type: "participant-left", participantId: "guest" });
  assert.equal(secondGuest.closed, null);
});

test("a departing guest's session token is remembered for a later reconnect, unlike the host's", async () => {
  const guest = new FakeSocket({
    id: "guest",
    name: "Guest",
    role: "guest",
    micMuted: false,
    sessionToken: "token-a",
  });
  const room = new KaraokeRoom({ getWebSockets: () => [] });

  await room.webSocketClose(guest, 1000, "gone");

  const entry = room.recentGuests.get("token-a");
  assert.equal(entry.id, "guest");
  assert.equal(typeof entry.disconnectedAt, "number");

  const host = new FakeSocket({
    id: "host",
    name: "Host",
    role: "host",
    micMuted: false,
    sessionToken: "should-be-ignored",
  });
  const hostRoom = new KaraokeRoom({ getWebSockets: () => [], storage: { delete: async () => {} } });
  await hostRoom.webSocketClose(host, 1000, "gone");
  assert.equal(hostRoom.recentGuests.size, 0);
});

test("reclaimGuestId returns and consumes a matching, still-fresh entry", () => {
  const recentGuests = new Map([["token-a", { id: "guest-1", disconnectedAt: 1_000 }]]);
  assert.equal(reclaimGuestId(recentGuests, "token-a", 1_000 + 44_000), "guest-1");
  // One-time consumption: a second reconnect attempt with the same token
  // (e.g. a duplicate/retried request) must not reclaim the same identity
  // twice -- the entry is gone once it's been used.
  assert.equal(reclaimGuestId(recentGuests, "token-a", 1_000 + 44_000), null);
});

test("reclaimGuestId ignores an unknown token or one past its grace window", () => {
  const recentGuests = new Map([["token-a", { id: "guest-1", disconnectedAt: 1_000 }]]);
  assert.equal(reclaimGuestId(recentGuests, "does-not-exist", 1_000), null);
  assert.equal(reclaimGuestId(recentGuests, "", 1_000), null);
  assert.equal(reclaimGuestId(recentGuests, "token-a", 1_000 + 45_001), null);
});

test("pruneRecentGuests drops only entries older than the grace window", () => {
  const recentGuests = new Map([
    ["stale", { id: "guest-old", disconnectedAt: 0 }],
    ["fresh", { id: "guest-new", disconnectedAt: 40_000 }],
  ]);
  pruneRecentGuests(recentGuests, 46_000);
  assert.deepEqual([...recentGuests.keys()], ["fresh"]);
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

test("remembers the host's last karaoke-player state and hands it to the next joiner", async () => {
  const host = new FakeSocket({ id: "host", role: "host" });
  const room = new KaraokeRoom({
    getWebSockets: () => [host],
    storage: { get: async () => undefined, put: async () => {} },
    acceptWebSocket: () => {},
  });
  const playbackState = { type: "karaoke-player", action: "seek", songId: "song", position: 42, commandId: "cmd-1" };

  await room.webSocketMessage(host, JSON.stringify({ type: "sync", state: playbackState }));
  assert.deepEqual(room.playbackState.state, playbackState);
  assert.equal(typeof room.playbackState.sentAt, "number");

  const late = new FakeSocket(null);
  late.serializeAttachment = (value) => { late.participant = value; };
  const previousPair = globalThis.WebSocketPair;
  globalThis.WebSocketPair = class {
    constructor() {
      this[0] = { label: "client" };
      this[1] = late;
    }
  };
  try {
    // The final `new Response(null, { status: 101, webSocket })` line is
    // Workers-runtime-specific and throws under plain `node --test`; the
    // room-state send (what this test cares about) happens just before it.
    await room.fetch(joinRequest({ role: "guest" })).catch(() => {});
    assert.deepEqual(late.messages[0].playbackState, playbackState);
    assert.equal(typeof late.messages[0].playbackSentAt, "number");
  } finally {
    globalThis.WebSocketPair = previousPair;
  }
});

test("a room with no playback yet omits playbackState from room-state", async () => {
  const late = new FakeSocket(null);
  late.serializeAttachment = (value) => { late.participant = value; };
  const previousPair = globalThis.WebSocketPair;
  globalThis.WebSocketPair = class {
    constructor() {
      this[0] = { label: "client" };
      this[1] = late;
    }
  };
  try {
    const room = new KaraokeRoom({
      getWebSockets: () => [],
      storage: { get: async () => undefined, put: async () => {} },
      acceptWebSocket: () => {},
    });
    await room.fetch(joinRequest({ role: "guest" })).catch(() => {});
    assert.equal(Object.hasOwn(late.messages[0], "playbackState"), false);
  } finally {
    globalThis.WebSocketPair = previousPair;
  }
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
