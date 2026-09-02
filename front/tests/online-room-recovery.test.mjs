import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OnlineRoomClient } from "../src/services/onlineRoom.js";
import OnlineVoiceMesh from "../src/services/onlineVoiceMesh.js";
import { createOnlineRoomMessageHandler } from "../src/contexts/onlineRoomMessages.js";

class Socket {
  static CLOSING = 2;
  static instances = [];
  constructor(url) { this.url = url; this.readyState = 0; this.packets = []; Socket.instances.push(this); }
  send(packet) { this.packets.push(JSON.parse(packet)); }
  close(code, reason) { this.readyState = 3; this.onclose?.({ code, reason }); }
  open() { this.readyState = 1; this.onopen(); }
  receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
}
const clients = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  Socket.instances = [];
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.disconnect());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function join(host = true) {
  const client = new OnlineRoomClient("wss://example.test");
  clients.push(client);
  const events = [];
  client.onMessage((message) => events.push(message));
  const joined = client.connect({ id: "ROOM", name: "Alice", host, hostToken: "secret" });
  const socket = Socket.instances.at(-1);
  socket.open();
  socket.receive({ type: "room-state", self: { id: host ? "host" : "guest", role: host ? "host" : "guest" }, participants: [] });
  await joined;
  return { client, socket, events };
}

test.each([true, false])("reconnects host=%s without emitting terminal disconnect, replays only safe state", async (host) => {
  const { client, socket, events } = await join(host);
  client.send("ui", { state: { query: "old query", songs: [{ id: "local" }], participantEffects: { volume: 0.7 } } });
  client.send("presence", { micMuted: true });
  client.send("effect-permission", { locked: true });
  socket.close(1006, "");
  expect(events.at(-1).type).toBe("connection-reconnecting");
  client.send("sync", { state: { type: "song-ready", songId: "song", commandId: "ready", revision: "sha256:test" } });
  client.send("sync", { state: { type: "karaoke-player", action: "play", commandId: "stale" } });
  await vi.advanceTimersByTimeAsync(500);
  const next = Socket.instances.at(-1);
  expect(new URL(next.url).searchParams.has("create")).toBe(false);
  if (host) {
    expect(new URL(next.url).searchParams.has("hostToken")).toBe(false);
    expect(next.packets).toEqual([]);
  }
  else expect(new URL(next.url).searchParams.get("sessionId")).toBe(new URL(socket.url).searchParams.get("sessionId"));
  next.open();
  if (host) expect(next.packets[0]).toEqual({ type: "host-auth", hostToken: "secret" });
  expect(events.some(({ type }) => type === "connection-restored")).toBe(false);
  next.receive({ type: "room-state", self: { id: host ? "host" : "guest" }, sharedUi: { query: "new query" } });
  await Promise.resolve();
  expect(events.at(-1).type).toBe("connection-restored");
  expect(events.some(({ type }) => type === "connection-closed")).toBe(false);
  expect(next.packets).toContainEqual({ type: "ui", state: { songs: [{ id: "local" }], participantEffects: { volume: 0.7 } } });
  expect(next.packets).toContainEqual({ type: "presence", micMuted: true });
  expect(next.packets).toContainEqual({ type: "effect-permission", locked: true });
  expect(next.packets.some((message) => message.state?.type === "song-ready")).toBe(true);
  expect(next.packets.some((message) => message.state?.commandId === "stale")).toBe(false);
});

test("failed retries stop at 45 seconds, not 45 seconds per attempt", async () => {
  const { socket, events } = await join();
  socket.close(1006, "");
  await vi.advanceTimersByTimeAsync(45_100);
  expect(events.filter(({ type }) => type === "connection-closed")).toHaveLength(1);
  const attempts = Socket.instances.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(attempts);
});

test("explicit leave or room-closed cancels all scheduled reconnect attempts", async () => {
  const { client, socket } = await join();
  socket.close(1006, "");
  client.disconnect();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
  const joined = await join(false);
  joined.socket.receive({ type: "room-closed", reason: "host-left" });
  joined.socket.close(4000, "Host left the room");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(2);
});

test("detects a silent half-open WebSocket while keeping periodic pongs healthy", async () => {
  const { socket, events } = await join();
  for (let n = 0; n < 5; n++) {
    await vi.advanceTimersByTimeAsync(3000);
    socket.receive({ type: "pong", serverTime: Date.now(), clientTime: Date.now() });
  }
  expect(events.some(({ type }) => type === "connection-reconnecting")).toBe(false);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(events.some(({ type }) => type === "connection-reconnecting")).toBe(true);
});

test("gets private TURN config once and ignores unrelated replies", async () => {
  const { client, socket } = await join();
  const first = client.getIceServers();
  expect(client.getIceServers()).toBe(first);
  const requestId = socket.packets.at(-1).requestId;
  socket.receive({ type: "ice-config", requestId: "wrong", iceServers: [] });
  expect(client.iceRequest).not.toBeNull();
  const iceServers = [{ urls: "turn:relay.test:3478", username: "temporary", credential: "password" }];
  socket.receive({ type: "ice-config", requestId, iceServers, expiresAt: Date.now() + 3600000 });
  expect(await first).toEqual(iceServers);
  expect(await client.getIceServers()).toEqual(iceServers);
  expect(socket.packets.filter(({ type }) => type === "ice-config-request")).toHaveLength(1);
});

test("TURN timeout falls back without hanging microphone start and reports the problem", async () => {
  const { client, events } = await join();
  const request = client.getIceServers();
  await vi.advanceTimersByTimeAsync(6000);
  expect(await request).toEqual([{ urls: "stun:stun.cloudflare.com:3478" }]);
  expect(events.some(({ type }) => type === "error")).toBe(true);
});

test("guest UI changes are accepted, errors visible, reconnect leaves media alone", () => {
  let ui = {};
  const voice = { peers: new Map([["guest", {}]]), invite: vi.fn().mockResolvedValue(true), removePeer: vi.fn(), stop: vi.fn() };
  const cleanup = vi.fn();
  const setVoiceError = vi.fn();
  const setRoomCommand = vi.fn();
  const handler = createOnlineRoomMessageHandler({
    id: "ROOM", client: {}, voice,
    roomRef: { current: { selfId: "host", host: true } },
    participantsRef: { current: [{ id: "host", role: "host" }, { id: "guest", role: "guest" }] },
    intentionalDisconnectRef: { current: false },
    cleanupConnection: cleanup, setRoom: vi.fn(), setParticipants: vi.fn(),
    setRoomUi: (change) => { ui = change(ui); }, setRoomCommand, setVoiceError,
  });
  handler({ type: "ui", fromId: "guest", state: { query: "Ария", radio: { isPlaying: false }, karaoke: { keyShift: 2 }, host: false } });
  expect(ui).toMatchObject({ query: "Ария", radio: { isPlaying: false }, karaoke: { keyShift: 2 } });
  expect(ui.host).toBeUndefined();
  handler({ type: "error", message: "rate limited" });
  expect(setVoiceError).toHaveBeenLastCalledWith("rate limited");
  handler({ type: "connection-reconnecting" });
  handler({ type: "host-reconnecting", participantId: "host" });
  handler({ type: "connection-restored" });
  expect(cleanup).not.toHaveBeenCalled();
  expect(voice.stop).not.toHaveBeenCalled();
  expect(voice.removePeer).not.toHaveBeenCalled();
  expect(voice.invite).not.toHaveBeenCalled();
  handler({ type: "room-state", self: { id: "host", role: "host" }, resumed: true, participants: [{ id: "guest" }], playbackState: { type: "karaoke-player", action: "pause", commandId: "guest-pause" } });
  expect(setRoomCommand).toHaveBeenCalledWith(expect.objectContaining({ commandId: "guest-pause" }));
});

test("re-invites a resumed participant whose peer was already torn down by an earlier participant-left", () => {
  // The server reuses a reconnecting participant's id and marks the rejoin
  // "resumed" so THEIR OWN client can self-heal via connection-restored
  // instead of re-inviting. But every OTHER client already tore its own
  // peer down when the earlier participant-left fired -- without a fresh
  // invite here they stay silently disconnected from this participant.
  const voice = { peers: new Map(), invite: vi.fn().mockResolvedValue(true), removePeer: vi.fn(), stop: vi.fn() };
  const handler = createOnlineRoomMessageHandler({
    id: "ROOM", client: {}, voice,
    roomRef: { current: { selfId: "host", host: true } },
    participantsRef: { current: [{ id: "host", role: "host" }] },
    intentionalDisconnectRef: { current: false },
    cleanupConnection: vi.fn(), setRoom: vi.fn(), setParticipants: vi.fn(),
    setRoomUi: vi.fn(), setRoomCommand: vi.fn(), setVoiceError: vi.fn(),
  });
  handler({ type: "participant-joined", participant: { id: "guest", role: "guest" }, resumed: true });
  expect(voice.invite).toHaveBeenCalledWith("guest");
});

test("does not re-invite a resumed participant whose peer connection is still alive", () => {
  const voice = {
    peers: new Map([["guest", {}]]),
    invite: vi.fn().mockResolvedValue(true),
    removePeer: vi.fn(),
    stop: vi.fn(),
  };
  const handler = createOnlineRoomMessageHandler({
    id: "ROOM", client: {}, voice,
    roomRef: { current: { selfId: "host", host: true } },
    participantsRef: { current: [{ id: "host", role: "host" }] },
    intentionalDisconnectRef: { current: false },
    cleanupConnection: vi.fn(), setRoom: vi.fn(), setParticipants: vi.fn(),
    setRoomUi: vi.fn(), setRoomCommand: vi.fn(), setVoiceError: vi.fn(),
  });
  handler({ type: "participant-joined", participant: { id: "guest", role: "guest" }, resumed: true });
  expect(voice.invite).not.toHaveBeenCalled();
});

test("mesh actually uses the received TURN settings and reports an initial connection timeout", async () => {
  const iceServers = [{ urls: "turn:relay.test:3478", username: "temp", credential: "temp" }];
  const peers = [];
  vi.stubGlobal("RTCPeerConnection", class {
    constructor(configuration) { this.configuration = configuration; this.connectionState = "new"; peers.push(this); }
    getSenders() { return []; }
    createDataChannel() { return { readyState: "connecting", close: vi.fn() }; }
    async createOffer() { return { type: "offer", sdp: "test" }; }
    async setLocalDescription(description) { this.localDescription = description; }
    close() { this.connectionState = "closed"; }
  });
  const mesh = new OnlineVoiceMesh({ getIceServers: vi.fn().mockResolvedValue(iceServers), send: vi.fn().mockReturnValue(true) });
  mesh.onPeerError = vi.fn();
  await mesh.invite("guest");
  expect(peers[0].configuration.iceServers).toEqual(iceServers);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mesh.onPeerError).toHaveBeenCalledWith("guest", expect.any(String));
  expect(mesh.peers.size).toBe(0);
  mesh.stop();
});
