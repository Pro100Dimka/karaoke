import assert from "node:assert/strict";
import { test, vi } from "vitest";

import { translateSaved } from "../src/i18n/runtime.js";

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
  const custom = { title: "Object title" };
  assert.equal(normalizeDialogOptions(custom), custom);
  for (const invalid of [[], null, undefined, 0, false, () => {}])
    assert.deepEqual(normalizeDialogOptions(invalid), {});

  assert.deepEqual(createDialogConfig("confirm", 5, "Custom"), {
    kind: "confirm",
    title: "Custom",
    label: translateSaved("Требуется подтверждение"),
    confirmText: translateSaved("Подтвердить"),
    cancelText: translateSaved("Отмена"),
    confirmClassName: "btn btn-primary",
    message: "5"
  });
  assert.equal(
    createDialogConfig("confirm", "message").title,
    translateSaved("Подтвердите действие")
  );
  assert.deepEqual(createDialogConfig("unknown", null), {
    kind: "alert",
    title: translateSaved("Уведомление"),
    label: "A&D Voice",
    confirmText: translateSaved("Понятно"),
    confirmClassName: "btn btn-primary",
    message: ""
  });
  assert.equal(createDialogConfig("alert", "message").message, "message");
});

test("room action opens local songs or requests missing packages", async () => {
  const client = { send: vi.fn() };
  const pendingSongCommandRef = { current: null };
  const setTransferStatus = vi.fn();
  const base = { songId: "song", client, pendingSongCommandRef, setTransferStatus };
  assert.equal(
    await openKaraokeInRoom({ ...base, room: null, isCurrentConnection: () => true }),
    true
  );
  assert.deepEqual(client.send.mock.calls.at(-1), [
    "sync",
    { state: { type: "open-karaoke", songId: "song" } }
  ]);
  assert.equal(
    await openKaraokeInRoom({ ...base, client: null, room: null, isCurrentConnection: () => true }),
    true
  );
  client.send.mockClear();
  assert.equal(
    await openKaraokeInRoom({ ...base, room: { host: true }, isCurrentConnection: () => false }),
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
  assert.deepEqual(client.send.mock.calls.at(-1), [
    "sync",
    { state: { type: "open-karaoke", songId: "song" } }
  ]);
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
  assert.deepEqual(setTransferStatus.mock.calls.at(-1), [ { stage: "waiting", percent: 0 } ]);
  assert.deepEqual(client.send.mock.calls.at(-1), [
    "sync",
    { state: { type: "song-request", songId: "song", requesterId: "self" } }
  ]);
  const disconnectedPending = { current: null };
  const disconnectedStatus = vi.fn();
  client.send.mockClear();
  assert.equal(
    await openKaraokeInRoom({
      ...base,
      pendingSongCommandRef: disconnectedPending,
      setTransferStatus: disconnectedStatus,
      room: { host: false },
      roomApi: { getSong: vi.fn().mockRejectedValue(new Error("missing")) },
      isCurrentConnection: () => false
    }),
    false
  );
  assert.equal(disconnectedPending.current, null);
  assert.equal(disconnectedStatus.mock.calls.length, 0);
  assert.equal(client.send.mock.calls.length, 0);
});

test("room messages update participants, UI, voice and connection state", async () => {
  assert.deepEqual(upsertParticipant([], null), []);
  assert.deepEqual(upsertParticipant([], { id: "a", name: "A" }), [ { id: "a", name: "A" } ]);
  assert.deepEqual(
    upsertParticipant([{ id: "a", name: "A" }], { id: "a", speaking: true }),
    [{ id: "a", name: "A", speaking: true }]
  );
  assert.deepEqual(
    upsertParticipant(
      [ { id: "a", name: "A" }, { id: "b", name: "B" } ],
      { id: "b", speaking: true }
    ),
    [ { id: "a", name: "A" }, { id: "b", name: "B", speaking: true } ]
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
    setRoom: vi.fn((value) => { room = value; }),
    setParticipants: vi.fn((value) => {
      participants = typeof value === "function" ? value(participants) : value;
    }),
    setRoomUi: vi.fn((value) => { ui = typeof value === "function" ? value(ui) : value; }),
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
  assert.equal(setters.setParticipants.mock.calls.length, 0);
  current = true;
  handler({ type: "room-state", self: { id: "self", role: "host" }, participants: [{ id: "a" }] });
  assert.deepEqual(room, { id: "AB-CD", selfId: "self", host: true, role: "host" });
  handler({ type: "room-state" });
  assert.deepEqual(participants, []);
  handler({ type: "room-state", self: { id: "guest", role: "guest" }, participants: [] });
  assert.equal(room.host, false);
  handler({ type: "participant-joined", participant: { id: "b" } });
  handler({ type: "participant-joined", participant: null });
  handler({ type: "participant-updated", participant: { id: "b", speaking: true } });
  assert.equal(participants.find((item) => item.id === "b").speaking, true);
  roomRef.current = { selfId: "self", host: true, role: "host", retained: "value" };
  handler({ type: "self-updated", self: { id: "self2", role: "guest" } });
  assert.deepEqual(room, { selfId: "self2", host: false, role: "guest", retained: "value" });
  const roomUpdates = setters.setRoom.mock.calls.length;
  handler({ type: "unknown", self: { id: "wrong", role: "host" } });
  handler({ type: "self-updated" });
  assert.equal(setters.setRoom.mock.calls.length, roomUpdates);
  roomRef.current = null;
  handler({ type: "self-updated", self: { id: "self3", role: "guest" } });
  assert.deepEqual(room, { selfId: "self3", host: false, role: "guest" });
  handler({ type: "self-updated", self: { id: "self4", role: "host" } });
  assert.deepEqual(room, { selfId: "self4", host: true, role: "host" });
  handler({ type: "room-state", participants: [{ id: "b" }, { id: "c" }] });
  handler({ type: "participant-left", participantId: "b" });
  assert.deepEqual(participants, [{ id: "c" }]);
  assert.deepEqual(voice.removePeer.mock.calls.at(-1), ["b"]);
  handler({ type: "signal", fromId: "a", signal: {} });
  ui = { effectsByParticipant: { old: { dry: 1 } } };
  handler({ type: "ui", fromId: "a", state: { radio: true, participantEffects: { echo: 1 } } });
  assert.equal(ui.__eventId.startsWith("ui-"), true);
  assert.deepEqual(ui.effectsByParticipant.old, { dry: 1 });
  handler({ type: "ui", fromId: "a", state: { participantEffects: { echo: 2 } } });
  const effectsBeforeMissingSender = ui.effectsByParticipant;
  handler({ type: "ui", state: { participantEffects: { echo: 9 } } });
  assert.equal(ui.effectsByParticipant, effectsBeforeMissingSender);
  handler({ type: "ui", fromId: "no-effects", state: { radio: false } });
  assert.equal(Object.hasOwn(ui.effectsByParticipant, "no-effects"), false);
  handler({ type: "ui" });
  assert.equal(ui.effectsByParticipant.a.echo, 2);
  assert.equal(ui.radio, false);
  assert.ok(ui.__eventId);
  ui = {};
  handler({ type: "ui", fromId: "first-effects", state: { participantEffects: { dry: 0.5 } } });
  assert.deepEqual(ui.effectsByParticipant, { "first-effects": { dry: 0.5 } });
  await flush();
  assert.equal(voice.invite.mock.calls.length, 1);
  assert.equal(voice.accept.mock.calls.length, 1);
  handler({ type: "connection-closed" });
  assert.equal(setters.cleanupConnection.mock.calls.length, 1);
  assert.deepEqual(setters.setRoom.mock.calls.at(-1), [null]);
  assert.deepEqual(setters.setParticipants.mock.calls.at(-1), [[]]);
  assert.deepEqual(setters.setVoiceError.mock.calls.at(-1), [
    translateSaved("Соединение с комнатой потеряно.")
  ]);
  intentionalDisconnectRef.current = true;
  handler({ type: "connection-closed" });
  assert.equal(setters.cleanupConnection.mock.calls.length, 1);

  intentionalDisconnectRef.current = false;
  const onConnectionClosed = vi.fn();
  createOnlineRoomMessageHandler({
    id: "room",
    client,
    voice,
    roomApi,
    roomRef,
    intentionalDisconnectRef,
    pendingSongCommandRef,
    onConnectionClosed,
    ...setters
  })({ type: "connection-closed" });
  assert.equal(onConnectionClosed.mock.calls.length, 1);

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
  defaultConnectionHandler({ type: "participant-joined", participant: { id: "late" } });
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
  const packageBlob = new Blob(["x"]);
  const roomApi = {
    exportSongPackage: vi.fn().mockResolvedValue(packageBlob),
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
  for (const [activeRoom, state] of [
    [
      { selfId: "self", host: false },
      { type: "song-request", requesterId: "guest", songId: "song" }
    ],
    [ { selfId: "self", host: true }, { type: "pause", requesterId: "guest", songId: "song" } ],
    [ { selfId: "self", host: true }, { type: "song-request", songId: "song" } ],
    [ { selfId: "self", host: true }, { type: "song-request", requesterId: "guest" } ],
    [null, { type: "song-request", requesterId: "guest", songId: "song" }]
  ]) {
    roomRef.current = activeRoom;
    handler({ type: "sync", state });
  }
  assert.equal(roomApi.exportSongPackage.mock.calls.length, 0);
  roomRef.current = { selfId: "self", host: true };
  setRoomCommand.mockClear();
  handler({ type: "sync", state: { type: "song-request", requesterId: "guest", songId: "song" } });
  await flush();
  assert.deepEqual(roomApi.exportSongPackage.mock.calls, [["song"]]);
  assert.deepEqual(voice.sendFile.mock.calls, [
    [ "guest", packageBlob, { kind: "song-package", songId: "song", filename: "song.karaoke.zip" } ]
  ]);
  assert.deepEqual(setTransferStatus.mock.calls, [ [{ stage: "sending", percent: 0 }], [null] ]);

  client.send.mockClear();
  setTransferStatus.mockClear();
  roomApi.exportSongPackage.mockRejectedValueOnce(new Error("export failed"));
  handler({ type: "sync", state: { type: "song-request", requesterId: "guest", songId: "song" } });
  await flush();
  assert.deepEqual(client.send.mock.calls, [
    [
      "sync",
      {
        state: {
          type: "song-transfer-error",
          requesterId: "guest",
          songId: "song",
          error: "export failed"
        }
      }
    ]
  ]);
  assert.deepEqual(setTransferStatus.mock.calls, [
    [{ stage: "error", error: "export failed", percent: 0 }]
  ]);
  pendingSongCommandRef.current = { type: "open-karaoke" };
  setTransferStatus.mockClear();
  handler({
    type: "sync",
    state: { type: "song-transfer-error", requesterId: "self", error: "remote" }
  });
  assert.equal(pendingSongCommandRef.current, null);
  assert.deepEqual(setTransferStatus.mock.calls, [
    [{ stage: "error", error: "remote", percent: 0 }]
  ]);
  setTransferStatus.mockClear();
  handler({ type: "sync", state: { type: "song-transfer-error", requesterId: "self" } });
  assert.deepEqual(setTransferStatus.mock.calls, [
    [ { stage: "error", error: translateSaved("Ведущий не смог передать песню"), percent: 0 } ]
  ]);
  setTransferStatus.mockClear();
  for (const [activeRoom, state] of [
    [ { selfId: "self", host: true }, { type: "song-transfer-error", requesterId: "other" } ],
    [ { selfId: "self", host: true }, { type: "pause", requesterId: "self" } ],
    [null, { type: "song-transfer-error", requesterId: "self" }]
  ]) {
    roomRef.current = activeRoom;
    handler({ type: "sync", state });
  }
  assert.equal(setTransferStatus.mock.calls.length, 0);

  roomRef.current = { selfId: "self", host: false };
  setRoomCommand.mockClear();
  handler({ type: "sync", sentAt: "now", state: { type: "open-karaoke", songId: "song" } });
  await flush();
  assert.equal(setRoomCommand.mock.calls.at(-1)[0].songId, "song");
  assert.equal( setRoomCommand.mock.calls.at(-1)[0].__eventId.startsWith("now-"), true
  );
  handler({ type: "sync", state: { type: "open-karaoke", songId: "song-without-stamp" } });
  await flush();
  assert.equal( setRoomCommand.mock.calls.at(-1)[0].__eventId.startsWith("sync-"), true
  );
  client.send.mockClear();
  setTransferStatus.mockClear();
  roomApi.getSong.mockRejectedValueOnce(new Error("missing"));
  handler({ type: "sync", state: { type: "open-karaoke", songId: "missing" } });
  await flush();
  assert.deepEqual(pendingSongCommandRef.current, { type: "open-karaoke", songId: "missing" });
  assert.deepEqual(setTransferStatus.mock.calls, [ [{ stage: "waiting", percent: 0 }] ]);
  assert.deepEqual(client.send.mock.calls, [
    [ "sync", { state: { type: "song-request", songId: "missing", requesterId: "self" } } ]
  ]);
  handler({ type: "sync", sentAt: "pause-stamp", state: { type: "pause" } });
  assert.equal(setRoomCommand.mock.calls.at(-1)[0].type, "pause");
  assert.equal( setRoomCommand.mock.calls.at(-1)[0].__eventId.startsWith("pause-stamp-"), true
  );
  handler({ type: "sync" });
  assert.equal( setRoomCommand.mock.calls.at(-1)[0].__eventId.startsWith("sync-"), true
  );

  let resolveExport;
  current = true;
  roomRef.current = { selfId: "self", host: true };
  const sentFilesBeforeStaleExport = voice.sendFile.mock.calls.length;
  const statusesBeforeStaleExport = setTransferStatus.mock.calls.length;
  roomApi.exportSongPackage.mockReturnValueOnce(
    new Promise((resolve) => { resolveExport = resolve; })
  );
  handler({ type: "sync", state: { type: "song-request", requesterId: "late", songId: "late" } });
  current = false;
  resolveExport(new Blob(["late"]));
  await flush();
  assert.equal(voice.sendFile.mock.calls.length, sentFilesBeforeStaleExport);
  assert.equal(setTransferStatus.mock.calls.length, statusesBeforeStaleExport);

  current = true;
  const sendsBeforeStaleError = client.send.mock.calls.length;
  const statusesBeforeStaleError = setTransferStatus.mock.calls.length;
  roomApi.exportSongPackage.mockRejectedValueOnce(new Error("stale export"));
  handler({ type: "sync", state: { type: "song-request", requesterId: "late", songId: "late" } });
  current = false;
  await flush();
  assert.equal(client.send.mock.calls.length, sendsBeforeStaleError);
  assert.equal(setTransferStatus.mock.calls.length, statusesBeforeStaleError);

  let resolveSend;
  current = true;
  roomRef.current = { selfId: "self", host: true };
  voice.sendFile.mockReturnValueOnce( new Promise((resolve) => { resolveSend = resolve; })
  );
  setTransferStatus.mockClear();
  handler({ type: "sync", state: { type: "song-request", requesterId: "slow", songId: "slow" } });
  await flush();
  assert.deepEqual(setTransferStatus.mock.calls, [ [{ stage: "sending", percent: 0 }] ]);
  current = false;
  resolveSend();
  await flush();
  assert.deepEqual(setTransferStatus.mock.calls, [ [{ stage: "sending", percent: 0 }] ]);

  let resolveSong;
  current = true;
  roomRef.current = { selfId: "self", host: false };
  roomApi.getSong.mockReturnValueOnce( new Promise((resolve) => { resolveSong = resolve; })
  );
  handler({ type: "sync", state: { type: "open-karaoke", songId: "late" } });
  const commandsBeforeStaleSong = setRoomCommand.mock.calls.length;
  current = false;
  resolveSong({});
  await flush();
  assert.equal(setRoomCommand.mock.calls.length, commandsBeforeStaleSong);

  current = true;
  const sendsBeforeStaleSong = client.send.mock.calls.length;
  const statusesBeforeStaleSong = setTransferStatus.mock.calls.length;
  const pendingBeforeStaleSong = pendingSongCommandRef.current;
  roomApi.getSong.mockRejectedValueOnce(new Error("stale song"));
  handler({ type: "sync", state: { type: "open-karaoke", songId: "late" } });
  current = false;
  await flush();
  assert.equal(client.send.mock.calls.length, sendsBeforeStaleSong);
  assert.equal(setTransferStatus.mock.calls.length, statusesBeforeStaleSong);
  assert.equal(pendingSongCommandRef.current, pendingBeforeStaleSong);
  current = true;
  roomRef.current = null;
  roomApi.getSong.mockResolvedValueOnce({});
  handler({ type: "sync", sentAt: "roomless", state: { type: "open-karaoke", songId: "roomless" } });
  await flush();
  assert.equal( setRoomCommand.mock.calls.at(-1)[0].__eventId.startsWith("roomless-"), true
  );
  client.send.mockClear();
  roomApi.getSong.mockRejectedValueOnce(new Error("room disappeared"));
  handler({ type: "sync", state: { type: "open-karaoke", songId: "roomless-missing" } });
  await flush();
  assert.deepEqual(client.send.mock.calls, [
    [
      "sync",
      { state: { type: "song-request", songId: "roomless-missing", requesterId: undefined } }
    ]
  ]);
  handler({ type: "sync", state: { type: "resume" } });
  handler({ type: "sync", state: { type: "pause" } });
});
