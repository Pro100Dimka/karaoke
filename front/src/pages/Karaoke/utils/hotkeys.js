/* Node's native ESM test runner requires the explicit extension. */
/* eslint-disable import/extensions */
import {
  isHotkeyScopeActive,
  shouldIgnoreHotkey
} from "../../../utils/hotkeys.js";
/* eslint-enable import/extensions */

export const KARAOKE_HOTKEYS = Object.freeze({
  Space: "toggle-playback",
  ArrowLeft: "seek-backward",
  ArrowRight: "seek-forward",
  Escape: "stop"
});

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

  return KARAOKE_HOTKEYS[event.code] ?? null;
}
