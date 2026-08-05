import assert from "node:assert/strict";
import test from "node:test";
import {
  getKaraokeHotkeyAction,
  isKaraokeHotkeyTarget,
  KARAOKE_HOTKEYS
} from "../src/pages/Karaoke/utils/hotkeys.js";

const target = (matches) => ({
  closest: () => (matches ? {} : null)
});

test("karaoke hotkey map is immutable and complete", () => {
  assert.equal(Object.isFrozen(KARAOKE_HOTKEYS), true);
  assert.deepEqual(KARAOKE_HOTKEYS, {
    Space: "toggle-playback",
    ArrowLeft: "seek-backward",
    ArrowRight: "seek-forward",
    Escape: "stop"
  });
});

test("karaoke hotkeys ignore editable and actionable targets", () => {
  assert.equal(isKaraokeHotkeyTarget(target(true)), true);
  assert.equal(getKaraokeHotkeyAction({ code: "Space", target: target(true) }), null);
});

test("karaoke hotkeys tolerate non-Element event targets", () => {
  assert.equal(isKaraokeHotkeyTarget(null), false);
  assert.equal(isKaraokeHotkeyTarget({}), false);
  assert.equal(getKaraokeHotkeyAction({ code: "Space", target: null }), "toggle-playback");
});

test("karaoke hotkeys ignore repeated and already handled events", () => {
  assert.equal(
    getKaraokeHotkeyAction({ code: "Space", repeat: true, target: target(false) }),
    null
  );
  assert.equal(
    getKaraokeHotkeyAction({
      code: "Space",
      defaultPrevented: true,
      target: target(false)
    }),
    null
  );
});

test("karaoke hotkeys map supported keys and reject unknown keys", () => {
  for (const [code, action] of Object.entries(KARAOKE_HOTKEYS)) {
    assert.equal(getKaraokeHotkeyAction({ code, target: target(false) }), action);
  }
  assert.equal(getKaraokeHotkeyAction({ code: "KeyK", target: target(false) }), null);
});
