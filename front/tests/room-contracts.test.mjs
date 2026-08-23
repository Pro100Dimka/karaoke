import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { flush } from "./helpers/async.mjs";
import { TEST_REVISION } from "./helpers/constants.mjs";
import { translateSaved } from "../src/i18n/runtime.js";
import { createDialogConfig, getDialogCloseResult, normalizeDialogOptions } from "../src/contexts/dialog-utils.js";
import { openKaraokeInRoom } from "../src/contexts/onlineRoomActions.js";
import { createOnlineRoomMessageHandler, upsertParticipant } from "../src/contexts/onlineRoomMessages.js";
import { equal, deepEqual } from "./helpers/assertions.mjs";
test("dialog contracts normalize kinds, messages and close results", () => {
  equal([getDialogCloseResult("confirm"), false], [getDialogCloseResult("alert"), true]);
  deepEqual([normalizeDialogOptions("Title"), { title: "Title" }]);
  const custom = { title: "Object title" };
  equal([normalizeDialogOptions(custom), custom]);
  for (const invalid of [[], null, undefined, 0, false, () => {}]) deepEqual([normalizeDialogOptions(invalid), {}]);
  deepEqual([
    createDialogConfig("confirm", 5, "Custom"),
    {
      kind: "confirm",
      title: "Custom",
      label: translateSaved("Требуется подтверждение"),
      confirmText: translateSaved("Подтвердить"),
      cancelText: translateSaved("Отмена"),
      confirmClassName: "btn btn-primary",
      message: "5"
    }
  ]);
  equal([createDialogConfig("confirm", "message").title, translateSaved("Подтвердите действие")]);
  deepEqual([
    createDialogConfig("unknown", null),
    {
      kind: "alert",
      title: translateSaved("Уведомление"),
      label: "A&D Voice",
      confirmText: translateSaved("Понятно"),
      confirmClassName: "btn btn-primary",
      message: ""
    }
  ]);
  equal([createDialogConfig("alert", "message").message, "message"]);
});
test("only the host can publish the room karaoke selection", async () => {
  const client = { send: vi.fn() };
  const hostSongCommandRef = { current: null };
  const base = {
    songId: "song",
    client,
    hostSongCommandRef,
    roomApi: { getSongRevision: vi.fn().mockResolvedValue({ revision: TEST_REVISION }) }
  };
  equal([await openKaraokeInRoom({ ...base, room: null, isCurrentConnection: () => true }), true]);
  const first = client.send.mock.calls[0][1].state;
  equal(
    [first.type, "open-karaoke"],
    [first.songId, "song"],
    [typeof first.commandId, "string"],
    [first.revision.startsWith("sha256:"), true],
    [hostSongCommandRef.current.commandId, first.commandId],
    [client.send.mock.calls.at(-1)[1].state.type, "start-karaoke"]
  );
  client.send.mockClear();
  equal(
    [await openKaraokeInRoom({ ...base, room: { host: true }, isCurrentConnection: () => true }), true],
    [client.send.mock.calls.length, 2]
  );
  client.send.mockClear();
  equal(
    [await openKaraokeInRoom({ ...base, room: { host: false }, isCurrentConnection: () => true }), false],
    [client.send.mock.calls.length, 0],
    [await openKaraokeInRoom({ ...base, room: { host: true }, isCurrentConnection: () => false }), true],
    [client.send.mock.calls.length, 0]
  );
});
test("a newer open-karaoke command rejects an earlier one still waiting on participant readiness", async () => {
  const client = { send: vi.fn() };
  const hostSongCommandRef = { current: null };
  const cancelTransfersByCommandId = vi.fn();
  const voice = { cancelTransfersByCommandId };
  const participantsRef = { current: [{ id: "guest-1" }] };
  const roomApi = {
    getSongRevision: vi.fn().mockResolvedValue({
      revision: TEST_REVISION
    })
  };
  const isCurrentConnection = () => true;
  const room = { host: true, selfId: "host" };
  const firstCall = openKaraokeInRoom({
    songId: "song-a",
    room,
    client,
    roomApi,
    isCurrentConnection,
    hostSongCommandRef,
    participantsRef,
    voice
  });
  // Observed immediately so Node doesn't flag it as unhandled the instant the second call
  // supersedes it below; the real assertion still happens via assert.rejects(firstCall).
  firstCall.catch(() => {});
  await flush();
  const firstCommandId = hostSongCommandRef.current.commandId;
  // Host picks a second song before every participant caught up on the first one. Without
  // rejecting the first call's readyPromise here, it would only settle after its own 5-minute
  // timeout, surfacing a stale "no response" error long after the host moved on.
  const secondCall = openKaraokeInRoom({
    songId: "song-b",
    room,
    client,
    roomApi,
    isCurrentConnection,
    hostSongCommandRef,
    participantsRef,
    voice
  });
  await flush();
  await assert.rejects(firstCall);
  equal([cancelTransfersByCommandId.mock.calls[0][0], firstCommandId], [hostSongCommandRef.current.songId, "song-b"]);
  hostSongCommandRef.current.markReady("guest-1");
  equal([await secondCall, true]);
});
test("room messages update participants, UI, voice and connection state", async () => {
  deepEqual(
    [upsertParticipant([], null), []],
    [upsertParticipant([], { id: "a", name: "A" }), [{ id: "a", name: "A" }]],
    [upsertParticipant([{ id: "a", name: "A" }], { id: "a", speaking: true }), [{ id: "a", name: "A", speaking: true }]],
    [
      upsertParticipant(
        [
          { id: "a", name: "A" },
          { id: "b", name: "B" }
        ],
        { id: "b", speaking: true }
      ),
      [
        { id: "a", name: "A" },
        { id: "b", name: "B", speaking: true }
      ]
    ]
  );
  let participants = [];
  const participantsRef = { current: [] };
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
    getSongRevision: vi.fn().mockResolvedValue({ revision: TEST_REVISION })
  };
  const setters = {
    cleanupConnection: vi.fn(),
    setRoom: vi.fn((value) => {
      room = value;
    }),
    setParticipants: vi.fn((value) => {
      participants = typeof value === "function" ? value(participants) : value;
      participantsRef.current = participants;
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
    participantsRef,
    intentionalDisconnectRef,
    pendingSongCommandRef,
    ...setters
  });
  current = false;
  handler({ type: "room-state" });
  equal([setters.setRoom.mock.calls.length, 0], [setters.setParticipants.mock.calls.length, 0]);
  current = true;
  handler({ type: "room-state", self: { id: "self", role: "host" }, participants: [{ id: "a" }] });
  deepEqual([room, { id: "AB-CD", selfId: "self", host: true, role: "host" }]);
  handler({ type: "room-state" });
  deepEqual([participants, []]);
  handler({ type: "room-state", self: { id: "guest", role: "guest" }, participants: [] });
  equal([room.host, false]);
  handler({ type: "participant-joined", participant: { id: "b" } });
  handler({ type: "participant-joined", participant: null });
  handler({ type: "participant-updated", participant: { id: "b", speaking: true } });
  equal([participants.find((item) => item.id === "b").speaking, true]);
  roomRef.current = { selfId: "self", host: true, role: "host", retained: "value" };
  handler({ type: "self-updated", self: { id: "self2", role: "guest" } });
  deepEqual([room, { selfId: "self2", host: false, role: "guest", retained: "value" }]);
  const roomUpdates = setters.setRoom.mock.calls.length;
  handler({ type: "unknown", self: { id: "wrong", role: "host" } });
  handler({ type: "self-updated" });
  equal([setters.setRoom.mock.calls.length, roomUpdates]);
  roomRef.current = null;
  handler({ type: "self-updated", self: { id: "self3", role: "guest" } });
  deepEqual([room, { selfId: "self3", host: false, role: "guest" }]);
  handler({ type: "self-updated", self: { id: "self4", role: "host" } });
  deepEqual([room, { selfId: "self4", host: true, role: "host" }]);
  handler({ type: "room-state", participants: [{ id: "b" }, { id: "c" }] });
  handler({ type: "participant-left", participantId: "b" });
  deepEqual([participants, [{ id: "c" }]], [voice.removePeer.mock.calls.at(-1), ["b"]]);
  handler({ type: "signal", fromId: "a", signal: {} });
  participantsRef.current = [
    { id: "a", role: "host" },
    { id: "guest", role: "guest" }
  ];
  ui = { effectsByParticipant: { old: { dry: 1 } } };
  handler({ type: "ui", fromId: "a", state: { radio: true, participantEffects: { echo: 1 } } });
  equal([ui.__eventId.startsWith("ui-"), true]);
  deepEqual([ui.effectsByParticipant.old, { dry: 1 }]);
  handler({ type: "ui", fromId: "a", state: { participantEffects: { echo: 2 } } });
  const effectsBeforeMissingSender = ui.effectsByParticipant;
  handler({ type: "ui", state: { participantEffects: { echo: 9 } } });
  equal([ui.effectsByParticipant, effectsBeforeMissingSender]);
  handler({ type: "ui", fromId: "no-effects", state: { radio: false } });
  equal([Object.hasOwn(ui.effectsByParticipant, "no-effects"), false]);
  handler({ type: "ui" });
  equal([ui.effectsByParticipant.a.echo, 2], [ui.radio, true]);
  assert.ok(ui.__eventId);
  ui = {};
  participantsRef.current = [...participantsRef.current, { id: "first-effects", role: "guest" }];
  handler({ type: "ui", fromId: "first-effects", state: { participantEffects: { dry: 0.5 } } });
  deepEqual([ui.effectsByParticipant, { "first-effects": { dry: 0.5 } }]);
  await flush();
  equal([voice.invite.mock.calls.length, 1], [voice.accept.mock.calls.length, 1]);
  handler({ type: "connection-closed" });
  equal([setters.cleanupConnection.mock.calls.length, 1]);
  deepEqual(
    [setters.setRoom.mock.calls.at(-1), [null]],
    [setters.setParticipants.mock.calls.at(-1), [[]]],
    [setters.setVoiceError.mock.calls.at(-1), [translateSaved("Соединение с комнатой потеряно.")]]
  );
  intentionalDisconnectRef.current = true;
  handler({ type: "connection-closed" });
  equal([setters.cleanupConnection.mock.calls.length, 1]);
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
  equal([onConnectionClosed.mock.calls.length, 1]);
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
  equal([rejectedVoice.invite.mock.calls.length, 1], [rejectedVoice.accept.mock.calls.length, 1]);
});
test("cleans a coalesced exported package even if the room becomes stale", async () => {
  let resolveExport;
  let current = true;
  const cleanup = vi.fn().mockResolvedValue();
  const hostSongCommandRef = {
    current: { type: "open-karaoke", songId: "song", commandId: "cmd", revision: TEST_REVISION }
  };
  const handler = createOnlineRoomMessageHandler({
    id: "room",
    client: { send: vi.fn() },
    voice: { sendFile: vi.fn(), invite: vi.fn(), removePeer: vi.fn(), accept: vi.fn() },
    roomApi: {
      exportSongPackage: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveExport = resolve;
          })
      )
    },
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
    state: {
      type: "song-request",
      requesterId: "guest",
      songId: "song",
      commandId: "cmd",
      revision: TEST_REVISION
    }
  });
  current = false;
  const blob = new Blob(["x"]);
  blob.cleanup = cleanup;
  resolveExport(blob);
  await flush();
  equal([cleanup.mock.calls.length, 1]);
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
    state: {
      type: "song-transfer-error",
      requesterId: "self",
      songId: "A",
      commandId: "cmd-A",
      error: "old"
    }
  });
  equal([pendingSongCommandRef.current.songId, "B"], [setTransferStatus.mock.calls.length, 0]);
  handler({
    type: "sync",
    fromId: "host",
    state: {
      type: "song-transfer-error",
      requesterId: "self",
      songId: "B",
      commandId: "cmd-B",
      error: "current"
    }
  });
  equal([pendingSongCommandRef.current, null]);
  deepEqual([setTransferStatus.mock.calls.at(-1)[0], { participantId: "host", stage: "error", error: "current", percent: 0 }]);
});
