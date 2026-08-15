/* Node's native ESM test runner requires the explicit extension. */
/* eslint-disable import/extensions */
import { isHotkeyScopeActive, shouldIgnoreHotkey } from "../../../utils/hotkeys.js";
/* eslint-enable import/extensions */

const HOTKEY_ACTIONS = { ArrowLeft: "seek-backward", ArrowRight: "seek-forward", Escape: "stop" };

export function getKaraokeHotkeyAction(event, scope) {
  if (
    event?.code === "Space" &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    isHotkeyScopeActive(scope)
  )
    return "toggle-playback";
  if (shouldIgnoreHotkey(event, scope)) return null;
  return Object.hasOwn(HOTKEY_ACTIONS, event.code)
    ? HOTKEY_ACTIONS[event.code]
    : null;
}
