import assert from "node:assert/strict";
import { test } from "vitest";

import { getKaraokeHotkeyAction } from "../src/pages/Karaoke/utils/hotkeys.js";

let importId = 0;
const loadHotkeys = () =>
  import(/* @vite-ignore */ `../src/utils/hotkeys.js?contract=${importId++}`);

function installDocument(dialogs = []) {
  globalThis.document = {
    querySelectorAll: (selector) => {
      assert.equal(selector, '[role="dialog"][aria-modal="true"]');
      return dialogs;
    }
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

test("editable targets use the complete protected selector", async () => {
  const { isEditableHotkeyTarget } = await loadHotkeys();
  const expected = [
    "input",
    "select",
    "textarea",
    "button",
    "a[href]",
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="slider"]',
    '[data-hotkeys="off"]'
  ].join(", ");
  assert.equal(
    isEditableHotkeyTarget({
      closest: (selector) => {
        assert.equal(selector, expected);
        return {};
      }
    }),
    true
  );
  assert.equal(isEditableHotkeyTarget({ closest: () => null }), false);
  assert.equal(isEditableHotkeyTarget({}), false);
  assert.equal(isEditableHotkeyTarget(null), false);
});

test("only the top dialog owns an active hotkey scope", async () => {
  const { isHotkeyScopeActive } = await loadHotkeys();
  const scope = { isConnected: true };
  assert.equal(isHotkeyScopeActive(null), false);
  assert.equal(isHotkeyScopeActive({ isConnected: false }), false);
  installDocument([]);
  assert.equal(isHotkeyScopeActive(scope), true);
  installDocument([
    { contains: (candidate) => candidate === scope },
    { contains: () => false }
  ]);
  assert.equal(isHotkeyScopeActive(scope), false);
  installDocument([
    { contains: () => false },
    { contains: (candidate) => candidate === scope }
  ]);
  assert.equal(isHotkeyScopeActive(scope), true);
});

test("every browser cancellation signal suppresses a hotkey", async () => {
  const { shouldIgnoreHotkey } = await loadHotkeys();
  const scope = { isConnected: true };
  const event = {
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    target: { closest: () => null }
  };
  installDocument();
  assert.equal(shouldIgnoreHotkey(event, scope), false);
  assert.equal(shouldIgnoreHotkey(null, scope), true);
  for (const property of ["defaultPrevented", "isComposing", "repeat"])
    assert.equal(
      shouldIgnoreHotkey({ ...event, [property]: true }, scope),
      true
    );
  assert.equal(
    shouldIgnoreHotkey({ ...event, target: { closest: () => ({}) } }, scope),
    true
  );
  assert.equal(shouldIgnoreHotkey(event, { isConnected: false }), true);
});
