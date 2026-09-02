import assert from "node:assert/strict";
import test from "node:test";

import {
  EFFECT_LIMITS,
  handleLogDelete,
  handleLogRegistration,
  handleLogUpload,
  KaraokeRoom,
  LogRateLimiter,
  normalizeParticipantEffects,
  purgeExpiredLogs,
  pruneRecentGuests,
  reclaimGuestId,
  ROOM_PROTOCOL_VERSION,
} from "../src/worker.js";
import worker from "../src/worker.js";
import { PARTICIPANT_EFFECT_LIMITS } from "../../front/src/contexts/onlineRoomEffects.js";
import { ROOM_PROTOCOL_VERSION as FRONTEND_ROOM_PROTOCOL_VERSION } from "../../front/src/services/roomProtocol.js";

test("health reports whether TURN credentials are configured", async () => {
  const withoutTurn = await worker.fetch(
    new Request("https://worker.test/health"),
    {},
  );
  const withTurn = await worker.fetch(
    new Request("https://worker.test/health"),
    {
      TURN_KEY_ID: "id",
      TURN_KEY_API_TOKEN: "token",
    },
  );
  assert.equal((await withoutTurn.json()).turnConfigured, false);
  assert.equal((await withTurn.json()).turnConfigured, true);
});

test("frontend and worker enforce identical participant effect limits", () => {
  assert.deepEqual(PARTICIPANT_EFFECT_LIMITS, EFFECT_LIMITS);
});

test("frontend and worker use the same room protocol version", () => {
  assert.equal(FRONTEND_ROOM_PROTOCOL_VERSION, ROOM_PROTOCOL_VERSION);
});

const joinRequest = (params = {}) => {
  const url = new URL("https://worker.test/rooms/ABCD1234");
  url.searchParams.set("v", String(ROOM_PROTOCOL_VERSION));
  url.searchParams.set("name", "Guest");
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
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

  serializeAttachment(participant) {
    this.participant = participant;
  }

  send(message) {
    this.messages.push(JSON.parse(message));
  }

  close(code, reason) {
    this.closed = { code, reason };
  }
}

const withoutOrdering = ({
  roomEpoch: _roomEpoch,
  eventSequence: _eventSequence,
  eventId: _eventId,
  snapshotVersion: _snapshotVersion,
  domain: _domain,
  ...message
}) => message;

test("fetch rejects a join attempt with a missing or wrong protocol version", async () => {
  const room = new KaraokeRoom({ getWebSockets: () => [] });

  const missing = await room.fetch(
    new Request("https://worker.test/rooms/ABCD1234?name=Guest", {
      headers: { Upgrade: "websocket" },
    }),
  );
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).expected, ROOM_PROTOCOL_VERSION);

  const wrong = await room.fetch(
    joinRequest({ v: String(ROOM_PROTOCOL_VERSION + 1) }),
  );
  assert.equal(wrong.status, 400);
});
test("fetch lets a correctly-versioned join proceed past the version gate", async () => {
  // A join carrying the current version must reach the *next* gate (room
  // capacity) instead of being rejected for its version -- full WS upgrade
  // isn't exercised here (that needs the Workers runtime's WebSocketPair,
  // unavailable under plain `node --test`), only that the version check
  // itself doesn't false-positive on a valid client.
  const full = Array.from(
    { length: 12 },
    (_, index) => new FakeSocket({ id: `p${index}`, role: "guest" }),
  );
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
    JSON.stringify({
      type: "signal",
      targetId: "target",
      signal: "я".repeat(33_000),
    }),
  );

  assert.equal(target.messages.length, 0);
  assert.deepEqual(sender.closed, { code: 1008, reason: "Signal too large" });
});

test("answers a private clock probe without broadcasting it", async () => {
  const sender = new FakeSocket({ id: "sender", role: "guest" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "ping", clientTime: 1234 }),
  );

  assert.equal(sender.messages.at(-1).type, "pong");
  assert.equal(sender.messages.at(-1).clientTime, 1234);
  assert.equal(Number.isFinite(sender.messages.at(-1).serverTime), true);
  assert.equal(target.messages.length, 0);
});

test("a guest can acknowledge an imported song without being disconnected", async () => {
  const sender = new FakeSocket({ id: "guest", role: "guest" });
  const host = new FakeSocket({ id: "host", role: "host" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, host] });
  const revision = `sha256:${"a".repeat(64)}`;

  await room.webSocketMessage(
    sender,
    JSON.stringify({
      type: "sync",
      state: {
        type: "song-ready",
        songId: "song-1",
        commandId: "command-1",
        revision,
        requesterId: "forged-id",
      },
    }),
  );

  assert.equal(sender.closed, null);
  assert.deepEqual(withoutOrdering(host.messages.at(-1)), {
    type: "sync",
    fromId: "guest",
    sentAt: host.messages.at(-1).sentAt,
    state: {
      type: "song-ready",
      songId: "song-1",
      commandId: "command-1",
      revision,
      requesterId: "guest",
    },
  });
  assert.equal(Number.isFinite(host.messages.at(-1).sentAt), true);
});

test("a guest can ask the host to start a song owned by any room participant", async () => {
  const sender = new FakeSocket({ id: "guest", role: "guest" });
  const owner = new FakeSocket({ id: "owner", role: "guest" });
  const host = new FakeSocket({ id: "host", role: "host" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, owner, host] });
  const revision = `sha256:${"b".repeat(64)}`;

  await room.webSocketMessage(
    sender,
    JSON.stringify({
      type: "sync",
      state: {
        type: "karaoke-request",
        songId: "song-2",
        ownerId: "owner",
        commandId: "command-2",
        revision,
        requesterId: "forged-id",
      },
    }),
  );

  assert.equal(sender.closed, null);
  assert.deepEqual(host.messages.at(-1).state, {
    type: "karaoke-request",
    songId: "song-2",
    ownerId: "owner",
    commandId: "command-2",
    revision,
    requesterId: "guest",
  });
  assert.deepEqual(owner.messages.at(-1).state, host.messages.at(-1).state);
});

test("an owner can lock remote effect control and unlock it again", async () => {
  const owner = new FakeSocket({ id: "owner", name: "Owner", role: "guest" });
  const controller = new FakeSocket({
    id: "controller",
    name: "Controller",
    role: "guest",
  });
  const room = new KaraokeRoom({ getWebSockets: () => [owner, controller] });

  await room.webSocketMessage(
    owner,
    JSON.stringify({ type: "effect-permission", locked: true }),
  );
  assert.equal(owner.participant.effectsLocked, true);
  assert.equal(controller.messages.at(-1).participant.effectsLocked, true);

  await room.webSocketMessage(
    controller,
    JSON.stringify({
      type: "effect-control",
      targetId: "owner",
      effects: { volume: 9 },
    }),
  );
  assert.equal(controller.messages.at(-1).type, "effect-control-denied");
  assert.equal(
    owner.messages.some(({ type }) => type === "effect-control"),
    false,
  );

  await room.webSocketMessage(
    owner,
    JSON.stringify({ type: "effect-permission", locked: false }),
  );
  await room.webSocketMessage(
    controller,
    JSON.stringify({
      type: "effect-control",
      targetId: "owner",
      effects: { volume: 9, reverb: 0.6, unsupported: 1 },
    }),
  );
  assert.deepEqual(owner.messages.at(-1), {
    type: "effect-control",
    fromId: "controller",
    effects: { volume: 2, reverb: 0.6 },
  });
  assert.deepEqual(normalizeParticipantEffects({ echo: -1, delay: 2 }), {
    echo: 0,
    delay: 1,
  });
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

  async list({ prefix = "" } = {}) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key })),
      truncated: false,
    };
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys])
      this.objects.delete(key);
  }
}

const logRequest = (payload, token) =>
  new Request("https://worker.test/logs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "127.0.0.1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

const logLimiter = {
  getByName: () => ({
    fetch: async () => new Response(JSON.stringify({ ok: true })),
  }),
};

async function registerLogDevice(bucket) {
  const response = await handleLogRegistration(
    new Request("https://worker.test/logs/register", {
      method: "POST",
      headers: { "cf-connecting-ip": "127.0.0.1" },
    }),
    { LOGS: bucket, LOG_RATE_LIMITER: logLimiter },
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("rejects legacy unsigned uploads instead of trusting a caller-selected file", async () => {
  const bucket = new FakeR2();
  const response = await handleLogUpload(
    logRequest({ user: "Studio PC", message: "something went wrong" }),
    { LOGS: bucket, LOG_RATE_LIMITER: logLimiter },
  );
  assert.equal(response.status, 400);
  assert.equal(bucket.objects.size, 0);
});

test("registers a token and appends authenticated batches to one file per device", async () => {
  const bucket = new FakeR2();
  const credentials = await registerLogDevice(bucket);
  const response = await handleLogUpload(
    logRequest(
      {
        device_id: credentials.device_id,
        display_name: "Singer",
        events: [
          {
            timestamp: "2026-08-27T00:00:00Z",
            level: "WARNING",
            message: "warning",
          },
        ],
      },
      credentials.upload_token,
    ),
    { LOGS: bucket, LOG_RATE_LIMITER: logLimiter },
  );
  assert.equal(response.status, 200);
  await handleLogUpload(
    logRequest(
      {
        device_id: credentials.device_id,
        display_name: "Renamed singer",
        events: [
          {
            timestamp: "2026-08-27T00:01:00Z",
            level: "ERROR",
            message: "error",
          },
        ],
        hardware: { cpu: "Test CPU" },
      },
      credentials.upload_token,
    ),
    { LOGS: bucket, LOG_RATE_LIMITER: logLimiter },
  );
  assert.deepEqual(
    [...bucket.objects.keys()],
    [`${credentials.device_id}.json`],
  );
  const stored = JSON.parse(
    bucket.objects.get(`${credentials.device_id}.json`),
  );
  assert.equal(stored.display_name, "Renamed singer");
  assert.equal(stored.hardware.cpu, "Test CPU");
  assert.deepEqual(
    stored.events.map(({ level, message }) => ({ level, message })),
    [
      { level: "WARNING", message: "warning" },
      { level: "ERROR", message: "error" },
    ],
  );
  assert.equal(
    stored.events.every(({ id, received_at: receivedAt }) => id && receivedAt),
    true,
  );

  const forged = await handleLogUpload(
    logRequest(
      {
        device_id: credentials.device_id,
        events: [{ level: "ERROR", message: "forged" }],
      },
      "wrong-token",
    ),
    { LOGS: bucket, LOG_RATE_LIMITER: logLimiter },
  );
  assert.equal(forged.status, 401);
  assert.equal(
    JSON.parse(bucket.objects.get(`${credentials.device_id}.json`)).events
      .length,
    2,
  );
});

test("rejects batches without hardware, warnings or errors", async () => {
  const bucket = new FakeR2();
  const credentials = await registerLogDevice(bucket);
  const response = await handleLogUpload(
    logRequest(
      {
        device_id: credentials.device_id,
        events: [{ level: "INFO", message: "noise" }],
      },
      credentials.upload_token,
    ),
    { LOGS: bucket, LOG_RATE_LIMITER: logLimiter },
  );
  assert.equal(response.status, 400);
});

test("reports an R2 write failure as retryable JSON", async () => {
  const bucket = new FakeR2();
  const credentials = await registerLogDevice(bucket);
  bucket.put = async () => {
    throw new Error("quota");
  };
  const response = await handleLogUpload(
    logRequest(
      {
        device_id: credentials.device_id,
        events: [{ level: "ERROR", message: "error" }],
      },
      credentials.upload_token,
    ),
    { LOGS: bucket, LOG_RATE_LIMITER: logLimiter },
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /retry later/);
});

test("the authenticated installation can delete its one Cloudflare log file", async () => {
  const bucket = new FakeR2();
  const credentials = await registerLogDevice(bucket);
  const request = new Request(
    `https://worker.test/logs/${credentials.device_id}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${credentials.upload_token}`,
        "cf-connecting-ip": "127.0.0.1",
      },
    },
  );
  const response = await handleLogDelete(
    request,
    { LOGS: bucket, LOG_RATE_LIMITER: logLimiter },
    credentials.device_id,
  );
  assert.equal(response.status, 200);
  assert.equal(bucket.objects.size, 0);
});

test("distributed log limiter persists the count in Durable Object storage", async () => {
  let stored;
  const limiter = new LogRateLimiter({
    storage: {
      get: async () => stored,
      put: async (_key, value) => {
        stored = value;
      },
    },
  });
  for (let index = 0; index < 30; index += 1) {
    assert.equal((await limiter.fetch()).status, 200);
  }
  assert.equal((await limiter.fetch()).status, 429);
});

test("daily retention removes only expired per-device log files", async () => {
  const bucket = new FakeR2();
  bucket.objects.set(
    "expired.json",
    JSON.stringify({ expires_at: "2026-01-01T00:00:00Z" }),
  );
  bucket.objects.set(
    "current.json",
    JSON.stringify({ expires_at: "2027-01-01T00:00:00Z" }),
  );
  bucket.objects.set("unknown.json", "invalid");

  assert.equal(
    await purgeExpiredLogs(
      bucket ? { LOGS: bucket } : {},
      Date.parse("2026-06-01T00:00:00Z"),
    ),
    1,
  );
  assert.deepEqual([...bucket.objects.keys()].sort(), [
    "current.json",
    "unknown.json",
  ]);
});

test("closes the room and disconnects every remaining guest when the host leaves", async () => {
  const host = new FakeSocket({
    id: "host",
    name: "Host",
    role: "host",
    micMuted: false,
  });
  const guest = new FakeSocket({
    id: "guest",
    name: "Guest",
    role: "guest",
    micMuted: false,
  });
  const deletedKeys = [];
  const room = new KaraokeRoom({
    getWebSockets: () => [guest],
    storage: {
      delete: async (keys) => deletedKeys.push(...keys),
      deleteAlarm: async () => {},
    },
  });

  await room.webSocketClose(host, 1000, "Client left room");

  assert.deepEqual(withoutOrdering(guest.messages.at(-1)), {
    type: "room-closed",
    reason: "host-left",
  });
  assert.deepEqual(guest.closed, { code: 4000, reason: "Host left the room" });
  assert.ok(deletedKeys.includes("hostToken"));
  assert.ok(deletedKeys.includes("sharedUi"));
});

test("a guest leaving only removes them from the participant list, without closing the room", async () => {
  const guest = new FakeSocket({
    id: "guest",
    name: "Guest",
    role: "guest",
    micMuted: false,
  });
  const secondGuest = new FakeSocket({
    id: "guest-2",
    name: "Guest 2",
    role: "guest",
    micMuted: false,
  });
  const room = new KaraokeRoom({ getWebSockets: () => [secondGuest] });

  await room.webSocketClose(guest, 1000, "gone");

  assert.deepEqual(withoutOrdering(secondGuest.messages.at(-1)), {
    type: "participant-left",
    participantId: "guest",
  });
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
  const hostRoom = new KaraokeRoom({
    getWebSockets: () => [],
    storage: { delete: async () => {}, deleteAlarm: async () => {} },
  });
  await hostRoom.webSocketClose(host, 1000, "Client left room");
  assert.equal(hostRoom.recentGuests.size, 0);
});

test("reclaimGuestId returns and consumes a matching, still-fresh entry", () => {
  const recentGuests = new Map([
    ["token-a", { id: "guest-1", disconnectedAt: 1_000 }],
  ]);
  assert.equal(
    reclaimGuestId(recentGuests, "token-a", 1_000 + 44_000),
    "guest-1",
  );
  // One-time consumption: a second reconnect attempt with the same token
  // (e.g. a duplicate/retried request) must not reclaim the same identity
  // twice -- the entry is gone once it's been used.
  assert.equal(reclaimGuestId(recentGuests, "token-a", 1_000 + 44_000), null);
});

test("reclaimGuestId ignores an unknown token or one past its grace window", () => {
  const recentGuests = new Map([
    ["token-a", { id: "guest-1", disconnectedAt: 1_000 }],
  ]);
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

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "ui", state: { filters } }),
  );

  assert.equal(sender.closed, null);
  assert.deepEqual(withoutOrdering(target.messages.at(-1)), {
    type: "ui",
    fromId: "sender",
    state: { filters },
  });
});

test("room broadcasts whether the library filter popover is visible", async () => {
  const host = new FakeSocket({ id: "host", role: "host" });
  const guest = new FakeSocket({ id: "guest", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [host, guest] });

  await room.webSocketMessage(
    host,
    JSON.stringify({ type: "ui", state: { libraryFiltersOpen: true } }),
  );

  assert.deepEqual(withoutOrdering(guest.messages.at(-1)), {
    type: "ui",
    fromId: "host",
    state: { libraryFiltersOpen: true },
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

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "ui", state: { karaoke } }),
  );

  assert.equal(sender.closed, null);
  assert.deepEqual(withoutOrdering(target.messages.at(-1)), {
    type: "ui",
    fromId: "sender",
    state: { karaoke },
  });
});

test("a guest broadcasts shared filters to everyone including itself", async () => {
  const sender = new FakeSocket({ id: "sender", role: "guest" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "ui", state: { filters: { genre: "Rock" } } }),
  );

  assert.equal(sender.closed, null);
  assert.deepEqual(withoutOrdering(sender.messages.at(-1)), {
    type: "ui",
    fromId: "sender",
    state: { filters: { genre: "Rock" } },
  });
  assert.deepEqual(target.messages.at(-1), sender.messages.at(-1));
});

test("stale, duplicated and previous-epoch room mutations never replace newer state", async () => {
  const sender = new FakeSocket({ id: "sender", role: "guest" });
  const target = new FakeSocket({ id: "target", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [sender, target] });
  const send = (clientSequence, query, roomEpoch = room.roomEpoch) =>
    room.webSocketMessage(
      sender,
      JSON.stringify({
        type: "ui",
        roomEpoch,
        clientSequence,
        state: { query },
      }),
    );

  await send(3, "newest");
  await send(2, "older");
  await send(3, "duplicate");
  await send(4, "previous epoch", "obsolete-epoch");

  assert.equal(room.sharedUi.query, "newest");
  assert.equal(target.messages.length, 1);
  assert.equal(target.messages[0].eventSequence, 1);
  assert.equal(target.messages[0].eventId, `${room.roomEpoch}:1`);

  await send(4, "authoritative");
  assert.equal(room.sharedUi.query, "authoritative");
  assert.equal(target.messages.at(-1).eventSequence, 2);
});

test("a guest can operate the validated shared karaoke transport", async () => {
  const guest = new FakeSocket({ id: "guest", role: "guest" });
  const host = new FakeSocket({ id: "host", role: "host" });
  const peer = new FakeSocket({ id: "peer", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [guest, host, peer] });
  const state = {
    type: "karaoke-player",
    action: "play",
    songId: "song",
    position: 12.5,
    commandId: "guest-play",
    executeAt: Date.now() + 450,
  };

  await room.webSocketMessage(guest, JSON.stringify({ type: "sync", state }));

  assert.equal(guest.closed, null);
  assert.deepEqual(room.playbackState.state, state);
  assert.deepEqual(host.messages.at(-1).state, state);
  assert.deepEqual(peer.messages.at(-1).state, state);
  assert.equal(guest.messages.length, 0);
});

test("remembers the host's last karaoke-player state and hands it to the next joiner", async () => {
  const host = new FakeSocket({ id: "host", role: "host" });
  const room = new KaraokeRoom({
    getWebSockets: () => [host],
    storage: {
      get: async (key) => (key === "hostToken" ? "owner-token" : undefined),
      put: async () => {},
    },
    acceptWebSocket: () => {},
  });
  const playbackState = {
    type: "karaoke-player",
    action: "seek",
    songId: "song",
    position: 42,
    commandId: "cmd-1",
  };

  await room.webSocketMessage(
    host,
    JSON.stringify({ type: "sync", state: playbackState }),
  );
  assert.deepEqual(room.playbackState.state, playbackState);
  assert.equal(typeof room.playbackState.sentAt, "number");

  const late = new FakeSocket(null);
  late.serializeAttachment = (value) => {
    late.participant = value;
  };
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
  late.serializeAttachment = (value) => {
    late.participant = value;
  };
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
      storage: {
        get: async (key) => (key === "hostToken" ? "owner-token" : undefined),
        put: async () => {},
      },
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
  const participantEffects = { volume: 0.5, reverb: 0.5, octave: -0.5 };
  const songs = [{ id: "song-1", title: "Song" }];

  await room.webSocketMessage(
    sender,
    JSON.stringify({ type: "ui", state: { participantEffects, songs } }),
  );

  assert.equal(sender.closed, null);
  assert.deepEqual(withoutOrdering(target.messages.at(-1)), {
    type: "ui",
    fromId: "sender",
    state: { participantEffects, songs },
  });
});

test("invalid UI state is rejected without disconnecting the room", async () => {
  const host = new FakeSocket({ id: "host", role: "host" });
  const guest = new FakeSocket({ id: "guest", role: "guest" });
  const room = new KaraokeRoom({ getWebSockets: () => [host, guest] });

  await room.webSocketMessage(
    host,
    JSON.stringify({
      type: "ui",
      state: { oversized: "x".repeat(129 * 1024) },
    }),
  );

  assert.equal(host.closed, null);
  assert.equal(guest.closed, null);
  assert.match(host.messages.at(-1).message, /too large/i);
});
