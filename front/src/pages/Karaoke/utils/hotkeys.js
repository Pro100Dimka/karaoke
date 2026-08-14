/* Node's native ESM test runner requires the explicit extension. */
/* eslint-disable import/extensions */
import {
  isHotkeyScopeActive,
  shouldIgnoreHotkey
} from "../../../utils/hotkeys.js";
/* eslint-enable import/extensions */

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
  switch (event.code) {
    case "ArrowLeft":
      return "seek-backward";
    case "ArrowRight":
      return "seek-forward";
    case "Escape":
      return "stop";
    default:
      return null;
  }
}
