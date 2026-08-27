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

test("only the host can publish the room karaoke selection", async () => {
  const client = { send: vi.fn() };
  const hostSongCommandRef = { current: null };
  const base = { songId: "song", client, hostSongCommandRef, roomApi: { getSongRevision: vi.fn().mockResolvedValue({ revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }) } };
  assert.equal(await openKaraokeInRoom({ ...base, room: null, isCurrentConnection: () => true }), true);
  const first = client.send.mock.calls[0][1].state;
  assert.equal(first.type, "open-karaoke");
  assert.equal(first.songId, "song");
  assert.equal(typeof first.commandId, "string");
  assert.equal(first.revision.startsWith("sha256:"), true);
  assert.equal(hostSongCommandRef.current.commandId, first.commandId);
  assert.equal(client.send.mock.calls.at(-1)[1].state.type, "start-karaoke");
  client.send.mockClear();
  assert.equal(await openKaraokeInRoom({ ...base, room: { host: true }, isCurrentConnection: () => true }), true);
  assert.equal(client.send.mock.calls.length, 2);
  client.send.mockClear();
  assert.equal(await openKaraokeInRoom({ ...base, room: { host: false }, isCurrentConnection: () => true }), false);
  assert.equal(client.send.mock.calls.length, 0);
  assert.equal(await openKaraokeInRoom({ ...base, room: { host: true }, isCurrentConnection: () => false }), true);
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
  const participantsRef = { current: [] };
  let room = null;
  let ui = { effectsByParticipant: { old: {} } };
  const roomRef = { current: { selfId: "self", host: true, role: "host" } };
  const intentionalDisconnectRef = { current: false };
  const pendingSongCommandRef = { current: null };
  const client = { send: vi.fn(), serverNow: vi.fn(() => 555_125) };
  const voice = {
    invite: vi.fn().mockResolvedValue(),
    removePeer: vi.fn(),
    accept: vi.fn().mockResolvedValue(),
    sendFile: vi.fn().mockResolvedValue()
  };
  const roomApi = {
    exportSongPackage: vi.fn().mockResolvedValue(new Blob(["x"])),
    getSongRevision: vi.fn().mockResolvedValue({ revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })
  };
  const setters = {
    cleanupConnection: vi.fn(),
    setRoom: vi.fn((value) => { room = value; }),
    setParticipants: vi.fn((value) => {
      participants = typeof value === "function" ? value(participants) : value;
      participantsRef.current = participants;
    }),
    setRoomUi: vi.fn((value) => { ui = typeof value === "function" ? value(ui) : value; }),
    setRoomCommand: vi.fn(),
    setVoiceError: vi.fn(),
    setTransferStatus: vi.fn()
  };
  let current = true;
  const onParticipantJoined = vi.fn();
  const onParticipantLeft = vi.fn();
  const handler = createOnlineRoomMessageHandler({
    id: " ab-cd ",
    client,
    voice,
    roomApi,
    isCurrentConnection: () => current,
    roomRef,
    participantsRef,
    intentionalDisconnectRef,
    pendingSongCommandRef,
    onParticipantJoined,
    onParticipantLeft,
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
  const playbackState = { type: "karaoke-player", action: "seek", songId: "song", position: 42 };
  handler({ type: "room-state", self: { id: "guest", role: "guest" }, participants: [], playbackState });
  const published = setters.setRoomCommand.mock.calls.at(-1)[0];
  assert.deepEqual(published, { ...playbackState, __eventId: published.__eventId });
  assert.equal(published.__eventId.startsWith("room-state-"), true);
  setters.setRoomCommand.mockClear();
  handler({ type: "room-state", self: { id: "self", role: "host" }, participants: [], playbackState });
  assert.equal(setters.setRoomCommand.mock.calls.length, 0);
  handler({ type: "participant-joined", participant: { id: "b" } });
  handler({ type: "participant-joined", participant: null });
  assert.deepEqual(onParticipantJoined.mock.calls, [[{ id: "b" }]]);
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
  assert.deepEqual(onParticipantLeft.mock.calls, [["b"]]);
  assert.deepEqual(participants, [{ id: "c" }]);
  assert.deepEqual(voice.removePeer.mock.calls.at(-1), ["b"]);
  handler({ type: "signal", fromId: "a", signal: {} });
  participantsRef.current = [{ id: "a", role: "host" }, { id: "guest", role: "guest" }];
  // useKaraokeTransport reads __serverSentAt/__receivedServerAt off the
  // published command to correct for delivery latency -- a live "sync" from
  // the host must actually carry them through, not just an __eventId.
  handler({
    type: "sync",
    fromId: "a",
    sentAt: 555_000,
    state: { type: "karaoke-player", action: "sync", songId: "song", position: 10 }
  });
  const synced = setters.setRoomCommand.mock.calls.at(-1)[0];
  assert.equal(synced.__serverSentAt, 555_000);
  assert.equal(synced.__receivedServerAt, 555_125);
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
  assert.equal(ui.radio, true);
  assert.ok(ui.__eventId);
  ui = {};
  handler({ type: "ui", fromId: "first-effects", state: { participantEffects: { dry: 0.5 } } });
  assert.deepEqual(ui.effectsByParticipant, { "first-effects": { dry: 0.5 } });

  // Every participant -- host or guest -- broadcasts their own library; a
  // guest's songs land tagged by sender instead of replacing shared state.
  ui = { songsByParticipant: { old: [{ id: "stale" }] } };
  handler({ type: "ui", fromId: "guest", state: { songs: [{ id: "song-a" }] } });
  assert.deepEqual(ui.songsByParticipant, {
    old: [{ id: "stale" }],
    guest: [{ id: "song-a" }]
  });
  handler({ type: "ui", fromId: "guest", state: { songs: [{ id: "song-b" }] } });
  assert.deepEqual(ui.songsByParticipant.guest, [{ id: "song-b" }]);
  const songsBeforeMissingSender = ui.songsByParticipant;
  handler({ type: "ui", state: { songs: [{ id: "orphan" }] } });
  assert.equal(ui.songsByParticipant, songsBeforeMissingSender);
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

  // The host leaving closes the whole room server-side (KaraokeRoom sends a
  // "room-closed" message ahead of its close frame) -- guests get this
  // specific reason instead of the generic "connection lost" text above.
  handler({ type: "room-closed", reason: "host-left" });
  assert.deepEqual(setters.setVoiceError.mock.calls.at(-1), [
    translateSaved("Хост покинул комнату. Комната закрыта.")
  ]);
  assert.deepEqual(setters.setRoom.mock.calls.at(-1), [null]);
  const cleanupCallsBeforeIntentional = setters.cleanupConnection.mock.calls.length;
  intentionalDisconnectRef.current = true;
  handler({ type: "room-closed", reason: "host-left" });
  assert.equal(setters.cleanupConnection.mock.calls.length, cleanupCallsBeforeIntentional);
  intentionalDisconnectRef.current = false;

  const onRoomClosed = vi.fn();
  createOnlineRoomMessageHandler({
    id: "room",
    client,
    voice,
    roomApi,
    roomRef,
    intentionalDisconnectRef,
    pendingSongCommandRef,
    onConnectionClosed: onRoomClosed,
    ...setters
  })({ type: "room-closed", reason: "host-left" });
  assert.deepEqual(onRoomClosed.mock.calls.at(-1), [
    translateSaved("Хост покинул комнату. Комната закрыта.")
  ]);

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


test("cleans a coalesced exported package even if the room becomes stale", async () => {
  let resolveExport;
  let current = true;
  const cleanup = vi.fn().mockResolvedValue();
  const hostSongCommandRef = { current: { type: "open-karaoke", songId: "song", commandId: "cmd", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } };
  const handler = createOnlineRoomMessageHandler({
    id: "room",
    client: { send: vi.fn() },
    voice: { sendFile: vi.fn(), invite: vi.fn(), removePeer: vi.fn(), accept: vi.fn() },
    roomApi: { exportSongPackage: vi.fn(() => new Promise((resolve) => { resolveExport = resolve; })) },
    isCurrentConnection: () => current,
    roomRef: { current: { selfId: "self", host: true } },
    participantsRef: { current: [{ id: "guest", role: "guest" }] },
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
  handler({
    type: "sync",
    fromId: "guest",
    state: { type: "song-request", requesterId: "guest", songId: "song", commandId: "cmd", revision: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  });
  current = false;
  const blob = new Blob(["x"]);
  blob.cleanup = cleanup;
  resolveExport(blob);
  await flush();
  assert.equal(cleanup.mock.calls.length, 1);
});

test("room song error is correlated to the current pending command", () => {
  const pendingSongCommandRef = {
    current: { type: "open-karaoke", songId: "B", commandId: "cmd-B" }
  };
  const setTransferStatus = vi.fn();
  const handler = createOnlineRoomMessageHandler({
    id: "room",
    client: { send: vi.fn() },
    voice: { invite: vi.fn(), removePeer: vi.fn(), accept: vi.fn() },
    roomApi: {},
    roomRef: { current: { selfId: "self", host: false } },
    participantsRef: { current: [{ id: "host", role: "host" }] },
    intentionalDisconnectRef: { current: false },
    pendingSongCommandRef,
    cleanupConnection: vi.fn(),
    setRoom: vi.fn(),
    setParticipants: vi.fn(),
    setRoomUi: vi.fn(),
    setRoomCommand: vi.fn(),
    setVoiceError: vi.fn(),
    setTransferStatus
  });
  handler({
    type: "sync",
    fromId: "host",
    state: { type: "song-transfer-error", requesterId: "self", songId: "A", commandId: "cmd-A", error: "old" }
  });
  assert.equal(pendingSongCommandRef.current.songId, "B");
  assert.equal(setTransferStatus.mock.calls.length, 0);
  handler({
    type: "sync",
    fromId: "host",
    state: { type: "song-transfer-error", requesterId: "self", songId: "B", commandId: "cmd-B", error: "current" }
  });
  assert.equal(pendingSongCommandRef.current, null);
  assert.deepEqual(setTransferStatus.mock.calls.at(-1)[0], {
    participantId: "host", stage: "error", error: "current", percent: 0
  });
});
