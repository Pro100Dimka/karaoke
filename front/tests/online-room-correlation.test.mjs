import { expect, test, vi } from "vitest";
import { createOnlineRoomMessageHandler } from "../src/contexts/onlineRoomMessages.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function guestHarness() {
  const pendingSongCommandRef = { current: null };
  const participantsRef = { current: [{ id: "host", role: "host" }] };
  const roomRef = { current: { selfId: "guest", host: false, role: "guest" } };
  const client = { send: vi.fn() };
  const setRoomCommand = vi.fn();
  const setTransferStatus = vi.fn();
  const lookups = new Map();
  const handler = createOnlineRoomMessageHandler({
    id: "room",
    client,
    voice: { invite: vi.fn(), removePeer: vi.fn(), accept: vi.fn() },
    roomApi: { getSong: vi.fn((songId) => lookups.get(songId).promise) },
    isCurrentConnection: () => true,
    roomRef,
    participantsRef,
    intentionalDisconnectRef: { current: false },
    pendingSongCommandRef,
    cleanupConnection: vi.fn(),
    setRoom: vi.fn(),
    setParticipants: vi.fn(),
    setRoomUi: vi.fn(),
    setRoomCommand,
    setVoiceError: vi.fn(),
    setTransferStatus
  });
  return { client, handler, lookups, pendingSongCommandRef, setRoomCommand, setTransferStatus };
}

test("newer open-karaoke command wins when older lookup resolves last", async () => {
  const h = guestHarness();
  h.lookups.set("A", deferred());
  h.lookups.set("B", deferred());
  h.handler({ type: "sync", fromId: "host", state: { type: "open-karaoke", songId: "A", commandId: "cmd-A" } });
  h.handler({ type: "sync", fromId: "host", state: { type: "open-karaoke", songId: "B", commandId: "cmd-B" } });
  h.lookups.get("B").resolve({});
  await flush();
  h.lookups.get("A").resolve({});
  await flush();
  expect(h.setRoomCommand).toHaveBeenCalledTimes(1);
  expect(h.setRoomCommand.mock.calls[0][0]).toMatchObject({ songId: "B", commandId: "cmd-B" });
});

test("stale lookup failure never requests superseded song", async () => {
  const h = guestHarness();
  h.lookups.set("A", deferred());
  h.lookups.set("B", deferred());
  h.handler({ type: "sync", fromId: "host", state: { type: "open-karaoke", songId: "A", commandId: "cmd-A" } });
  h.handler({ type: "sync", fromId: "host", state: { type: "open-karaoke", songId: "B", commandId: "cmd-B" } });
  h.lookups.get("B").resolve({});
  await flush();
  h.lookups.get("A").reject(new Error("missing"));
  await flush();
  expect(h.client.send).not.toHaveBeenCalled();
});

test("stale song-transfer-error cannot clear newer pending command", () => {
  const h = guestHarness();
  h.pendingSongCommandRef.current = { type: "open-karaoke", songId: "B", commandId: "cmd-B" };
  h.handler({
    type: "sync",
    fromId: "host",
    state: { type: "song-transfer-error", requesterId: "guest", songId: "A", commandId: "cmd-A", error: "old" }
  });
  expect(h.pendingSongCommandRef.current).toMatchObject({ songId: "B", commandId: "cmd-B" });
  expect(h.setTransferStatus).not.toHaveBeenCalled();
});

test("host exports only a currently offered command and coalesces package creation", async () => {
  const exportDeferred = deferred();
  const roomApi = { exportSongPackage: vi.fn(() => exportDeferred.promise) };
  const voice = { sendFile: vi.fn().mockResolvedValue(), invite: vi.fn(), removePeer: vi.fn(), accept: vi.fn() };
  const hostSongCommandRef = { current: { type: "open-karaoke", songId: "A", commandId: "cmd-A" } };
  const handler = createOnlineRoomMessageHandler({
    id: "room",
    client: { send: vi.fn() },
    voice,
    roomApi,
    roomRef: { current: { selfId: "host", host: true } },
    participantsRef: { current: [{ id: "g1", role: "guest" }, { id: "g2", role: "guest" }] },
    intentionalDisconnectRef: { current: false },
    pendingSongCommandRef: { current: null },
    hostSongCommandRef,
    songExportsRef: { current: new Map() },
    cleanupConnection: vi.fn(),
    setRoom: vi.fn(),
    setParticipants: vi.fn(),
    setRoomUi: vi.fn(),
    setRoomCommand: vi.fn(),
    setVoiceError: vi.fn(),
    setTransferStatus: vi.fn()
  });
  handler({ type: "sync", fromId: "g1", state: { type: "song-request", requesterId: "g1", songId: "A", commandId: "cmd-A" } });
  handler({ type: "sync", fromId: "g2", state: { type: "song-request", requesterId: "g2", songId: "A", commandId: "cmd-A" } });
  handler({ type: "sync", fromId: "g1", state: { type: "song-request", requesterId: "g1", songId: "X", commandId: "bad" } });
  expect(roomApi.exportSongPackage).toHaveBeenCalledTimes(1);
  const blob = new Blob(["song"]);
  blob.cleanup = vi.fn();
  exportDeferred.resolve(blob);
  await flush();
  expect(voice.sendFile).toHaveBeenCalledTimes(2);
  expect(blob.cleanup).toHaveBeenCalledTimes(1);
});
