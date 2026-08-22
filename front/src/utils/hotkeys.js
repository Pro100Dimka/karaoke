const EDITABLE = [
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
export const isEditableHotkeyTarget = (target) => Boolean(target?.closest?.(EDITABLE));
export function isHotkeyScopeActive(scope) {
  if (!scope?.isConnected) return false;
  const dialogs = globalThis.document?.querySelectorAll?.('[role="dialog"][aria-modal="true"]');
  const top = dialogs ? [...dialogs].at(-1) : null;
  return !top || top.contains(scope);
}
export const shouldIgnoreHotkey = (event, scope) =>
  !event ||
  event.defaultPrevented ||
  event.isComposing ||
  event.repeat ||
  isEditableHotkeyTarget(event.target) ||
  !isHotkeyScopeActive(scope);
