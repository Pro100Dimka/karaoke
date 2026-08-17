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
  const voice = { invite: vi.fn(), removePeer: vi.fn(), accept: vi.fn() };
  const handler = createOnlineRoomMessageHandler({
    id: "room",
    client,
    voice,
    roomApi: { getSongRevision: vi.fn((songId) => lookups.get(songId).promise) },
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
  return {
    client,
    handler,
    lookups,
    pendingSongCommandRef,
    setRoomCommand,
    setTransferStatus,
    voice
  };
}

test("newer open-karaoke command wins when older lookup resolves last", async () => {
  const h = guestHarness();
  h.lookups.set("A", deferred());
  h.lookups.set("B", deferred());
  h.handler({ type: "sync", fromId: "host", state: { type: "open-karaoke", songId: "A", commandId: "cmd-A", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  h.handler({ type: "sync", fromId: "host", state: { type: "open-karaoke", songId: "B", commandId: "cmd-B", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  h.lookups.get("B").resolve({ revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  await flush();
  h.lookups.get("A").resolve({ revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  await flush();
  expect(h.setRoomCommand).not.toHaveBeenCalled();
  expect(h.client.send).toHaveBeenCalledTimes(1);
  expect(h.client.send).toHaveBeenCalledWith("sync", {
    state: expect.objectContaining({ type: "song-ready", songId: "B", commandId: "cmd-B" })
  });
});

test("stale lookup failure never requests superseded song", async () => {
  const h = guestHarness();
  h.lookups.set("A", deferred());
  h.lookups.set("B", deferred());
  h.handler({ type: "sync", fromId: "host", state: { type: "open-karaoke", songId: "A", commandId: "cmd-A", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  h.handler({ type: "sync", fromId: "host", state: { type: "open-karaoke", songId: "B", commandId: "cmd-B", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  h.lookups.get("B").resolve({ revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  await flush();
  h.lookups.get("A").reject(new Error("missing"));
  await flush();
  expect(h.client.send).toHaveBeenCalledTimes(1);
  expect(h.client.send).toHaveBeenCalledWith("sync", {
    state: expect.objectContaining({ type: "song-ready", songId: "B", commandId: "cmd-B" })
  });
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

test("a host open-karaoke push rejects a still-pending manual syncSong request instead of stranding it", () => {
  const h = guestHarness();
  h.lookups.set("pushed", deferred());
  const cancelTransfersByCommandId = vi.fn();
  h.voice.cancelTransfersByCommandId = cancelTransfersByCommandId;
  const resolve = vi.fn();
  const reject = vi.fn();
  h.pendingSongCommandRef.current = {
    type: "sync-song",
    songId: "manual-song",
    commandId: "cmd-manual",
    revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ownerId: "owner",
    __manual: true,
    resolve,
    reject
  };
  h.handler({
    type: "sync",
    fromId: "host",
    state: {
      type: "open-karaoke",
      songId: "pushed",
      commandId: "cmd-push",
      revision: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
  });
  expect(cancelTransfersByCommandId).toHaveBeenCalledWith("cmd-manual");
  expect(reject).toHaveBeenCalledTimes(1);
  expect(reject.mock.calls[0][0]).toBeInstanceOf(Error);
  expect(resolve).not.toHaveBeenCalled();
  expect(h.pendingSongCommandRef.current).toMatchObject({ commandId: "cmd-push", songId: "pushed" });
});

test("host exports only a currently offered command and coalesces package creation", async () => {
  const exportDeferred = deferred();
  const roomApi = { exportSongPackage: vi.fn(() => exportDeferred.promise) };
  const voice = { sendFile: vi.fn().mockResolvedValue(), invite: vi.fn(), removePeer: vi.fn(), accept: vi.fn() };
  const hostSongCommandRef = { current: { type: "open-karaoke", songId: "A", commandId: "cmd-A", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } };
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
  handler({ type: "sync", fromId: "g1", state: { type: "song-request", requesterId: "g1", songId: "A", commandId: "cmd-A", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  handler({ type: "sync", fromId: "g2", state: { type: "song-request", requesterId: "g2", songId: "A", commandId: "cmd-A", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
  handler({ type: "sync", fromId: "g1", state: { type: "song-request", requesterId: "g1", songId: "X", commandId: "bad" } });
  expect(roomApi.exportSongPackage).toHaveBeenCalledExactlyOnceWith("A", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const blob = new Blob(["song"]);
  blob.cleanup = vi.fn();
  exportDeferred.resolve(blob);
  await flush();
  expect(voice.sendFile).toHaveBeenCalledTimes(2);
  expect(blob.cleanup).toHaveBeenCalledTimes(1);
});
