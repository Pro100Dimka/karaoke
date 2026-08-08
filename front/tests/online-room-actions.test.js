import assert from "node:assert/strict";
import test from "node:test";
import { openKaraokeInRoom } from "../src/contexts/onlineRoomActions.js";
import { createRoomId } from "../src/services/onlineRoom.js";

test("createRoomId uses UUID when available", () => {
  const id = createRoomId({
    randomUUID: () => "12345678-90ab-cdef-1234-567890abcdef"
  });

  assert.equal(id, "12345678");
});

test("createRoomId falls back to cryptographic random bytes", () => {
  const id = createRoomId({
    getRandomValues(bytes) {
      bytes.set([0, 1, 254, 255]);
      return bytes;
    }
  });

  assert.equal(id, "0001FEFF");
});

test("createRoomId has a deterministic last-resort fallback", () => {
  assert.equal(
    createRoomId(null, () => 0.5),
    "80000000"
  );
});

test("stale karaoke lookup cannot send into a newer room", async () => {
  let resolveSong;
  const sent = [];
  let current = true;
  const resultPromise = openKaraokeInRoom({
    songId: "song-1",
    room: { selfId: "guest-1", host: false },
    client: { send: (...args) => sent.push(args) },
    roomApi: {
      getSong: () =>
        new Promise((resolve) => {
          resolveSong = resolve;
        })
    },
    isCurrentConnection: () => current,
    pendingSongCommandRef: { current: null },
    setVoiceError() {}
  });

  current = false;
  resolveSong({ id: "song-1" });

  assert.equal(await resultPromise, false);
  assert.deepEqual(sent, []);
});

test("missing guest song requests a package only for the active room", async () => {
  const sent = [];
  const pendingSongCommandRef = { current: null };
  const errors = [];
  const result = await openKaraokeInRoom({
    songId: "song-2",
    room: { selfId: "guest-2", host: false },
    client: { send: (...args) => sent.push(args) },
    roomApi: {
      getSong: async () => {
        throw new Error("missing");
      }
    },
    isCurrentConnection: () => true,
    pendingSongCommandRef,
    setVoiceError: (message) => errors.push(message)
  });

  assert.equal(result, false);
  assert.equal(pendingSongCommandRef.current.songId, "song-2");
  assert.equal(pendingSongCommandRef.current.__originatedHere, true);
  assert.equal(errors.at(-1), "Получаем песню от ведущего…");
  assert.deepEqual(sent, [
    [
      "sync",
      {
        state: {
          type: "song-request",
          songId: "song-2",
          requesterId: "guest-2"
        }
      }
    ]
  ]);
});
