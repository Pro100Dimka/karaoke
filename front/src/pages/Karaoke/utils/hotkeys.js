import { shouldIgnoreHotkey } from "../../../utils/hotkeys";

export const KARAOKE_HOTKEYS = Object.freeze({
  Space: "toggle-playback",
  ArrowLeft: "seek-backward",
  ArrowRight: "seek-forward",
  Escape: "stop"
});

export function getKaraokeHotkeyAction(event, scope) {
  if (shouldIgnoreHotkey(event, scope)) return null;

  return KARAOKE_HOTKEYS[event.code] ?? null;
}
