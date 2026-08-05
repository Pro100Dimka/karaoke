export const KARAOKE_HOTKEYS = Object.freeze({
  Space: "toggle-playback",
  ArrowLeft: "seek-backward",
  ArrowRight: "seek-forward",
  Escape: "stop"
});

const EDITABLE_SELECTOR = [
  "input",
  "select",
  "textarea",
  "button",
  "a[href]",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="textbox"]'
].join(", ");

export function isKaraokeHotkeyTarget(target) {
  return Boolean(
    target &&
      typeof target.closest === "function" &&
      target.closest(EDITABLE_SELECTOR)
  );
}

export function getKaraokeHotkeyAction(event) {
  if (
    !event ||
    event.defaultPrevented ||
    event.repeat ||
    isKaraokeHotkeyTarget(event.target)
  ) {
    return null;
  }

  return KARAOKE_HOTKEYS[event.code] ?? null;
}
