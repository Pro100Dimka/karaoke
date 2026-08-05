import assert from "node:assert/strict";
import test from "node:test";
import {
  KARAOKE_PREFERENCES_KEY,
  loadKaraokePreferences,
  saveKaraokePreferences
} from "../src/pages/Karaoke/utils/preferences.js";

function createStorage(initialValue = null) {
  const values = new Map();
  if (initialValue != null) values.set(KARAOKE_PREFERENCES_KEY, initialValue);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    read: () => values.get(KARAOKE_PREFERENCES_KEY)
  };
}

test("loadKaraokePreferences reads an object", () => {
  const storage = createStorage('{"speed":1.25}');
  assert.deepEqual(loadKaraokePreferences(storage), { speed: 1.25 });
});

test("loadKaraokePreferences rejects malformed and non-object values", () => {
  assert.deepEqual(loadKaraokePreferences(createStorage("{")), {});
  assert.deepEqual(loadKaraokePreferences(createStorage("[]")), {});
  assert.deepEqual(loadKaraokePreferences(createStorage("null")), {});
});

test("saveKaraokePreferences serializes safely", () => {
  const storage = createStorage();
  assert.equal(saveKaraokePreferences({ showNotes: false }, storage), true);
  assert.equal(storage.read(), '{"showNotes":false}');
});

test("saveKaraokePreferences reports storage failures", () => {
  const storage = {
    setItem() {
      throw new Error("quota");
    }
  };
  assert.equal(saveKaraokePreferences({}, storage), false);
});
