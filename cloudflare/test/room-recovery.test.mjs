import assert from "node:assert/strict";
import test from "node:test";
import { KaraokeRoom, normalizeRoomUi } from "../src/worker.js";
import { generateRoomIce } from "../src/roomIce.js";

class Socket {
  constructor(participant) { this.participant = participant; this.messages = []; }
  serializeAttachment(value) { this.participant = value; }
  deserializeAttachment() { return this.participant; }
  send(value) { this.messages.push(JSON.parse(value)); }
  close(code, reason) { this.closed = { code, reason }; }
}
function harness() {
  const token = "a".repeat(64);
  const data = new Map([["hostToken", token]]);
  const host = new Socket({ id: "host", name: "Host", role: "host", micMuted: true, effectsLocked: true });
  const guest = new Socket({ id: "guest", name: "Guest", role: "guest" });
  const sockets = [guest];
  const storage = {
    get: async (key) => structuredClone(data.get(key)),
    put: async (key, value) => data.set(key, structuredClone(value)),
    delete: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => data.delete(key)),
    setAlarm: async (time) => { storage.alarm = time; },
    deleteAlarm: async () => { storage.alarm = null; },
  };
  const ctx = { storage, getWebSockets: () => sockets, acceptWebSocket: (socket) => sockets.push(socket) };
  return { room: new KaraokeRoom(ctx), ctx, storage, host, guest, sockets, data, token };
}

test("host network loss preserves peers and persists the 45-second grace through hibernation", async () => {
  const h = harness();
  const before = Date.now();
  await h.room.webSocketClose(h.host, 1006, "");
  assert.equal(h.guest.closed, undefined);
  assert.equal(h.guest.messages.at(-1).type, "host-reconnecting");
  assert.ok(h.storage.alarm >= before + 45_000);
  assert.equal(h.data.get("hostToken"), h.token);
  const resumedObject = new KaraokeRoom(h.ctx);
  await resumedObject.ready;
  assert.equal(resumedObject.hostDeadline, h.storage.alarm);
  assert.equal(resumedObject.participants().find(({ id }) => id === "host").reconnecting, true);
  await resumedObject.alarm(); // early/already-delivered alarm cannot close the room
  assert.equal(h.guest.closed, undefined);
  resumedObject.hostDeadline = Date.now() - 1;
  await resumedObject.alarm();
  assert.equal(h.guest.messages.at(-1).reason, "host-timeout");
  assert.equal(h.guest.closed.code, 4000);
  assert.equal(h.data.has("hostToken"), false);
});

test("the same host token restores identity, permissions, snapshot and cancels expiry", async () => {
  const h = harness();
  await h.room.webSocketMessage(h.guest, JSON.stringify({ type: "ui", state: { query: "Ария", karaoke: { speed: 1.2 } } }));
  await h.room.webSocketClose(h.host, 1006, "");
  const room = new KaraokeRoom(h.ctx);
  const socket = new Socket(null);
  const oldPair = globalThis.WebSocketPair;
  const oldResponse = globalThis.Response;
  globalThis.WebSocketPair = class { constructor() { this[0] = {}; this[1] = socket; } };
  globalThis.Response = class { constructor(body, options) { Object.assign(this, options); } };
  try {
    const result = await room.fetch(new Request(`https://worker.test/rooms/ROOM?v=1&role=host&hostToken=${h.token}`, { headers: { Upgrade: "websocket" } }));
    assert.equal(result.status, 101);
    assert.deepEqual(socket.messages[0].self, { id: "host", name: "Гость", role: "host", micMuted: true, effectsLocked: true });
    assert.equal(socket.messages[0].sharedUi.query, "Ария");
    assert.equal(socket.messages[0].sharedUi.karaoke.speed, 1.2);
    assert.equal(h.storage.alarm, null);
    await room.alarm();
    assert.equal(h.guest.closed, undefined);
    // A close callback from a replaced connection is harmless.
    await room.webSocketClose(h.host, 1006, "");
    assert.equal(room.hostDeadline, null);
  } finally { globalThis.WebSocketPair = oldPair; globalThis.Response = oldResponse; }
});

test("only the owner can resume; a vanished room is not recreated by reconnect", async () => {
  const h = harness();
  await h.room.webSocketClose(h.host, 1006, "");
  let result = await h.room.fetch(new Request("https://worker.test/rooms/ROOM?v=1&role=host&hostToken=wrong", { headers: { Upgrade: "websocket" } }));
  assert.equal(result.status, 403);
  await h.room.closeRoom("host-left");
  h.sockets.length = 0;
  result = await h.room.fetch(new Request(`https://worker.test/rooms/ROOM?v=1&role=host&hostToken=${h.token}`, { headers: { Upgrade: "websocket" } }));
  assert.equal(result.status, 403);
});

test("all shared controls converge; a guest cannot forge per-participant maps or roles", async () => {
  const h = harness();
  h.sockets.push(h.host);
  const state = { query: "Song", filters: { genre: "Rock", sort: "artist" }, radio: { isPlaying: true, volume: 0.2, stationId: "rock" }, karaoke: { speed: 1.25, keyShift: -2, showNotes: false } };
  await h.room.webSocketMessage(h.guest, JSON.stringify({ type: "ui", state: { ...state, host: true, songsByParticipant: { host: [] } } }));
  assert.deepEqual(h.host.messages.at(-1).state, state);
  assert.deepEqual(h.guest.messages.at(-1).state, state);
  assert.deepEqual(h.data.get("sharedUi"), state);
  const fresh = new KaraokeRoom(h.ctx);
  await fresh.ready;
  assert.deepEqual(fresh.sharedUi, state);
  assert.equal(normalizeRoomUi({ host: true }), null);
  assert.equal(normalizeRoomUi([]), null);
});

test("ICE bursts do not consume playback or heartbeat budget; overload never closes the host", async () => {
  const h = harness();
  h.sockets.push(h.host);
  for (let n = 0; n < 350; n++) await h.room.webSocketMessage(h.host, JSON.stringify({ type: "signal", targetId: "guest", signal: { candidate: n } }));
  for (let n = 0; n < 500; n++) await h.room.webSocketMessage(h.host, JSON.stringify({ type: "ui", state: { query: String(n) } }));
  assert.equal(h.host.closed, undefined);
  assert.equal(h.host.messages.at(-1).code, "rate-limit");
  await h.room.webSocketMessage(h.host, JSON.stringify({ type: "ping", clientTime: 123 }));
  assert.equal(h.host.messages.at(-1).type, "pong");
});

test("a dead socket does not stop broadcast; chat never leaks reconnect identity", async () => {
  const h = harness();
  h.host.send = () => { throw new Error("closed"); };
  h.sockets.unshift(h.host);
  h.guest.participant.sessionToken = "private";
  await h.room.webSocketMessage(h.guest, JSON.stringify({ type: "chat", text: "hello" }));
  assert.equal(h.guest.messages.at(-1).text, "hello");
  assert.equal(Object.hasOwn(h.guest.messages.at(-1).from, "sessionToken"), false);
});

test("TURN keys stay server-side and unusable port 53 is filtered", async () => {
  let calls = 0;
  const config = await generateRoomIce({ TURN_KEY_ID: "key-id", TURN_KEY_API_TOKEN: "private-token" }, async (url, options) => {
    calls++;
    assert.ok(url.endsWith("/key-id/credentials/generate-ice-servers"));
    assert.equal(options.headers.Authorization, "Bearer private-token");
    return new Response(JSON.stringify({ iceServers: [{ urls: ["turn:turn.cloudflare.com:53?transport=udp", "turn:turn.cloudflare.com:3478?transport=udp"], username: "temporary-user", credential: "temporary-password" }] }));
  });
  assert.equal(calls, 1);
  assert.equal(config.relayAvailable, true);
  assert.deepEqual(config.iceServers[0].urls, ["turn:turn.cloudflare.com:3478?transport=udp"]);
  assert.equal(JSON.stringify(config).includes("private-token"), false);
  assert.equal((await generateRoomIce({})).relayAvailable, false);
  await assert.rejects(generateRoomIce({ TURN_KEY_ID: "x", TURN_KEY_API_TOKEN: "y" }, async () => new Response("error", { status: 503 })));
});

test("ICE configuration is private and reused for a participant", async () => {
  const h = harness();
  h.sockets.push(h.host);
  await h.room.webSocketMessage(h.guest, JSON.stringify({ type: "ice-config-request", requestId: "one" }));
  const cached = h.room.iceCredentials.get("guest");
  await h.room.webSocketMessage(h.guest, JSON.stringify({ type: "ice-config-request", requestId: "two" }));
  assert.equal(h.room.iceCredentials.get("guest"), cached);
  assert.equal(h.host.messages.length, 0);
  assert.equal(h.guest.messages.at(-1).requestId, "two");
});
