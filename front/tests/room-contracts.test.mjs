import assert from "node:assert/strict";
import { test, vi } from "vitest";

import {
  createDialogConfig,
  getDialogCloseResult,
  normalizeDialogOptions
} from "../src/contexts/dialog-utils.js";
import { openKaraokeInRoom } from "../src/contexts/onlineRoomActions.js";
import {
  createOnlineRoomMessageHandler,
  upsertParticipant
} from "../src/contexts/onlineRoomMessages.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("dialog contracts normalize kinds, messages and close results", () => {
  assert.equal(getDialogCloseResult("confirm"), false);
  assert.equal(getDialogCloseResult("alert"), true);
  assert.deepEqual(normalizeDialogOptions("Title"), { title: "Title" });
  assert.deepEqual(normalizeDialogOptions([]), {});
  assert.deepEqual(normalizeDialogOptions(null), {});
  assert.equal(createDialogConfig("confirm", 5, "Custom").message, "5");
  assert.equal(createDialogConfig("unknown", null).kind, "alert");
});

test("room action opens local songs or requests missing packages", async () => {
  const client = { send: vi.fn() };
  const pendingSongCommandRef = { current: null };
  const setTransferStatus = vi.fn();
  const base = {
    songId: "song",
    client,
    pendingSongCommandRef,
    setTransferStatus
  };
  assert.equal(
    await openKaraokeInRoom({
      ...base,
      room: null,
      isCurrentConnection: () => true
    }),
    true
  );
  assert.equal(client.send.mock.calls.at(-1)[1].state.type, "open-karaoke");
  client.send.mockClear();
  assert.equal(
    await openKaraokeInRoom({
      ...base,
      room: { host: true },
      isCurrentConnection: () => false
    }),
    true
  );
  assert.equal(client.send.mock.calls.length, 0);
  assert.equal(
    await openKaraokeInRoom({
      ...base,
      room: { host: false },
      roomApi: { getSong: vi.fn().mockResolvedValue({}) },
      isCurrentConnection: () => true
    }),
    true
  );
  assert.equal(
    await openKaraokeInRoom({
      ...base,
      room: { host: false },
      roomApi: { getSong: vi.fn().mockResolvedValue({}) },
      isCurrentConnection: () => false
    }),
    false
  );
  assert.equal(
    await openKaraokeInRoom({
      ...base,
      room: { host: false, selfId: "self" },
      roomApi: { getSong: vi.fn().mockRejectedValue(new Error("missing")) },
      isCurrentConnection: () => true
    }),
    false
  );
  assert.equal(pendingSongCommandRef.current.__originatedHere, true);
  assert.equal(client.send.mock.calls.at(-1)[1].state.type, "song-request");
  assert.equal(
    await openKaraokeInRoom({
      ...base,
      room: { host: false },
      roomApi: { getSong: vi.fn().mockRejectedValue(new Error("missing")) },
      isCurrentConnection: () => false
    }),
    false
  );
});

test("room messages update participants, UI, voice and connection state", async () => {
  assert.deepEqual(upsertParticipant([], null), []);
  assert.deepEqual(upsertParticipant([], { id: "a", name: "A" }), [
    { id: "a", name: "A" }
  ]);
  assert.deepEqual(
    upsertParticipant([{ id: "a", name: "A" }], { id: "a", speaking: true }),
    [{ id: "a", name: "A", speaking: true }]
  );
  let participants = [];
  let room = null;
  let ui = { effectsByParticipant: { old: {} } };
  const roomRef = { current: { selfId: "self", host: true, role: "host" } };
  const intentionalDisconnectRef = { current: false };
  const pendingSongCommandRef = { current: null };
  const client = { send: vi.fn() };
  const voice = {
    invite: vi.fn().mockResolvedValue(),
    removePeer: vi.fn(),
    accept: vi.fn().mockResolvedValue(),
    sendFile: vi.fn().mockResolvedValue()
  };
  const roomApi = {
    exportSongPackage: vi.fn().mockResolvedValue(new Blob(["x"])),
    getSong: vi.fn().mockResolvedValue({})
  };
  const setters = {
    cleanupConnection: vi.fn(),
    setRoom: vi.fn((value) => {
      room = value;
    }),
    setParticipants: vi.fn((value) => {
      participants = typeof value === "function" ? value(participants) : value;
    }),
    setRoomUi: vi.fn((value) => {
      ui = typeof value === "function" ? value(ui) : value;
    }),
    setRoomCommand: vi.fn(),
    setVoiceError: vi.fn(),
    setTransferStatus: vi.fn()
  };
  let current = true;
  const handler = createOnlineRoomMessageHandler({
    id: " ab-cd ",
    client,
    voice,
    roomApi,
    isCurrentConnection: () => current,
    roomRef,
    intentionalDisconnectRef,
    pendingSongCommandRef,
    ...setters
  });
  current = false;
  handler({ type: "room-state" });
  assert.equal(setters.setRoom.mock.calls.length, 0);
  current = true;
  handler({
    type: "room-state",
    self: { id: "self", role: "host" },
    participants: [{ id: "a" }]
  });
  assert.equal(room.host, true);
  handler({ type: "room-state" });
  handler({ type: "participant-joined", participant: { id: "b" } });
  handler({ type: "participant-joined", participant: null });
  handler({
    type: "participant-updated",
    participant: { id: "b", speaking: true }
  });
  assert.equal(participants.find((item) => item.id === "b").speaking, true);
  handler({ type: "self-updated", self: { id: "self2", role: "guest" } });
  assert.equal(room.host, false);
  roomRef.current = null;
  handler({ type: "self-updated", self: { id: "self3", role: "guest" } });
  handler({ type: "participant-left", participantId: "b" });
  assert.equal(
    participants.some((item) => item.id === "b"),
    false
  );
  handler({ type: "signal", fromId: "a", signal: {} });
  ui = {};
  handler({
    type: "ui",
    fromId: "a",
    state: { radio: true, participantEffects: { echo: 1 } }
  });
  handler({
    type: "ui",
    fromId: "a",
    state: { participantEffects: { echo: 2 } }
  });
  handler({ type: "ui" });
  assert.equal(ui.effectsByParticipant.a.echo, 2);
  assert.equal(ui.radio, true);
  assert.ok(ui.__eventId);
  await flush();
  assert.equal(voice.invite.mock.calls.length, 1);
  assert.equal(voice.accept.mock.calls.length, 1);
  handler({ type: "connection-closed" });
  assert.equal(setters.cleanupConnection.mock.calls.length, 1);
  intentionalDisconnectRef.current = true;
  handler({ type: "connection-closed" });
  assert.equal(setters.cleanupConnection.mock.calls.length, 1);

  const rejectedVoice = {
    ...voice,
    invite: vi.fn().mockRejectedValue(new Error("invite failed")),
    accept: vi.fn().mockRejectedValue(new Error("signal failed"))
  };
  const defaultConnectionHandler = createOnlineRoomMessageHandler({
    id: "room",
    client,
    voice: rejectedVoice,
    roomApi,
    roomRef,
    intentionalDisconnectRef,
    pendingSongCommandRef,
    ...setters
  });
  defaultConnectionHandler({
    type: "participant-joined",
    participant: { id: "late" }
  });
  defaultConnectionHandler({ type: "signal", fromId: "late", signal: {} });
  await flush();
  assert.equal(rejectedVoice.invite.mock.calls.length, 1);
  assert.equal(rejectedVoice.accept.mock.calls.length, 1);
});

test("room song synchronization covers send, receive and error recovery", async () => {
  const roomRef = { current: { selfId: "self", host: true } };
  const pendingSongCommandRef = { current: null };
  const client = { send: vi.fn() };
  const voice = {
    invite: vi.fn().mockResolvedValue(),
    removePeer: vi.fn(),
    accept: vi.fn().mockResolvedValue(),
    sendFile: vi.fn().mockResolvedValue()
  };
  const roomApi = {
    exportSongPackage: vi.fn().mockResolvedValue(new Blob(["x"])),
    getSong: vi.fn().mockResolvedValue({})
  };
  const setRoomCommand = vi.fn();
  const setTransferStatus = vi.fn();
  let current = true;
  const handler = createOnlineRoomMessageHandler({
    id: "room",
    client,
    voice,
    roomApi,
    isCurrentConnection: () => current,
    roomRef,
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
  handler({
    type: "sync",
    state: { type: "song-request", requesterId: "guest", songId: "song" }
  });
  await flush();
  assert.equal(voice.sendFile.mock.calls[0][2].kind, "song-package");
  assert.equal(setTransferStatus.mock.calls.at(-1)[0], null);

  roomApi.exportSongPackage.mockRejectedValueOnce(new Error("export failed"));
  handler({
    type: "sync",
    state: { type: "song-request", requesterId: "guest", songId: "song" }
  });
  await flush();
  assert.equal(
    client.send.mock.calls.at(-1)[1].state.type,
    "song-transfer-error"
  );
  handler({
    type: "sync",
    state: { type: "song-transfer-error", requesterId: "self", error: "remote" }
  });
  assert.equal(setTransferStatus.mock.calls.at(-1)[0].stage, "error");
  handler({
    type: "sync",
    state: { type: "song-transfer-error", requesterId: "self" }
  });

  roomRef.current = { selfId: "self", host: false };
  handler({
    type: "sync",
    sentAt: "now",
    state: { type: "open-karaoke", songId: "song" }
  });
  await flush();
  assert.equal(setRoomCommand.mock.calls.at(-1)[0].songId, "song");
  handler({
    type: "sync",
    state: { type: "open-karaoke", songId: "song-without-stamp" }
  });
  await flush();
  roomApi.getSong.mockRejectedValueOnce(new Error("missing"));
  handler({ type: "sync", state: { type: "open-karaoke", songId: "missing" } });
  await flush();
  assert.equal(pendingSongCommandRef.current.songId, "missing");
  assert.equal(client.send.mock.calls.at(-1)[1].state.type, "song-request");
  handler({ type: "sync", state: { type: "pause" } });
  assert.equal(setRoomCommand.mock.calls.at(-1)[0].type, "pause");
  handler({ type: "sync" });

  let resolveExport;
  current = true;
  roomRef.current = { selfId: "self", host: true };
  roomApi.exportSongPackage.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveExport = resolve;
    })
  );
  handler({
    type: "sync",
    state: { type: "song-request", requesterId: "late", songId: "late" }
  });
  current = false;
  resolveExport(new Blob(["late"]));
  await flush();

  current = true;
  roomApi.exportSongPackage.mockRejectedValueOnce(new Error("stale export"));
  handler({
    type: "sync",
    state: { type: "song-request", requesterId: "late", songId: "late" }
  });
  current = false;
  await flush();

  let resolveSong;
  current = true;
  roomRef.current = { selfId: "self", host: false };
  roomApi.getSong.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveSong = resolve;
    })
  );
  handler({ type: "sync", state: { type: "open-karaoke", songId: "late" } });
  current = false;
  resolveSong({});
  await flush();

  current = true;
  roomApi.getSong.mockRejectedValueOnce(new Error("stale song"));
  handler({ type: "sync", state: { type: "open-karaoke", songId: "late" } });
  current = false;
  await flush();
  current = true;
  handler({ type: "sync", state: { type: "resume" } });
  handler({ type: "sync", state: { type: "pause" } });
});
