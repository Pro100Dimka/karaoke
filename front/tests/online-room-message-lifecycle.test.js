import assert from "node:assert/strict";
import test from "node:test";
import { createOnlineRoomMessageHandler } from "../src/contexts/onlineRoomMessages.js";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function createHandler(overrides = {}) {
  return createOnlineRoomMessageHandler({
    id: "ROOM1234",
    client: { send() {} },
    roomApi: {
      getSong: async () => ({}),
      exportSongPackage: async () => new Blob()
    },
    voice: {
      invite: async () => {},
      removePeer() {},
      accept: async () => {},
      sendFile: async () => {}
    },
    isCurrentConnection: () => true,
    roomRef: { current: { host: false, selfId: "self" } },
    intentionalDisconnectRef: { current: false },
    pendingSongCommandRef: { current: null },
    cleanupConnection() {},
    setRoom() {},
    setParticipants() {},
    setRoomUi() {},
    setRoomCommand() {},
    setVoiceError() {},
    ...overrides
  });
}

test("stale room handlers ignore messages immediately", () => {
  let participantsChanged = false;
  const handler = createHandler({
    isCurrentConnection: () => false,
    setParticipants() {
      participantsChanged = true;
    }
  });

  handler({ type: "room-state", participants: [{ id: "guest" }] });

  assert.equal(participantsChanged, false);
});

test("stale open-karaoke lookup cannot update a newer room", async () => {
  const lookup = deferred();
  let current = true;
  let command = null;
  const handler = createHandler({
      roomApi: { getSong: () => lookup.promise },
      isCurrentConnection: () => current,
      setRoomCommand(next) {
        command = next;
      }
    });

    handler({
      type: "sync",
      state: { type: "open-karaoke", songId: "song-1" }
    });
    current = false;
    lookup.resolve({ id: "song-1" });
    await flushPromises();

    assert.equal(command, null);
});

test("stale song export cannot send a file or update room errors", async () => {
  const exported = deferred();
  let current = true;
  let sent = 0;
  const errors = [];
  const handler = createHandler({
      roomApi: { exportSongPackage: () => exported.promise },
      isCurrentConnection: () => current,
      roomRef: { current: { host: true, selfId: "host" } },
      voice: {
        invite: async () => {},
        removePeer() {},
        accept: async () => {},
        async sendFile() {
          sent += 1;
        }
      },
      setVoiceError(message) {
        errors.push(message);
      }
    });

    handler({
      type: "sync",
      state: {
        type: "song-request",
        requesterId: "guest",
        songId: "song-1"
      }
    });
    current = false;
    exported.resolve(new Blob(["song"]));
    await flushPromises();

    assert.equal(sent, 0);
    assert.deepEqual(errors, []);
});
