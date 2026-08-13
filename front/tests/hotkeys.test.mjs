import assert from "node:assert/strict";
import { test } from "vitest";

import { getKaraokeHotkeyAction } from "../src/pages/Karaoke/utils/hotkeys.js";

function installDocument(dialogs = []) {
  globalThis.document = {
    querySelectorAll: () => dialogs
  };
}

test("space always controls karaoke inside the active scope", () => {
  installDocument();
  const scope = { isConnected: true };
  const input = { closest: () => ({ tagName: "INPUT" }) };
  const event = {
    code: "Space",
    target: input,
    defaultPrevented: false,
    isComposing: false,
    repeat: false
  };

  assert.equal(getKaraokeHotkeyAction(event, scope), "toggle-playback");
});

test("space does not escape a modal outside karaoke", () => {
  const scope = { isConnected: true };
  installDocument([{ contains: () => false }]);

  assert.equal(
    getKaraokeHotkeyAction(
      {
        code: "Space",
        target: null,
        defaultPrevented: false,
        isComposing: false,
        repeat: false
      },
      scope
    ),
    null
  );
});
