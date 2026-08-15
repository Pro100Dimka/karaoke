const EDITABLE_SELECTOR = [
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

export function isEditableHotkeyTarget(target) {
  return Boolean(target?.closest?.(EDITABLE_SELECTOR));
}

export function isHotkeyScopeActive(scope) {
  if (!scope?.isConnected) return false;
  const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')];
  const topDialog = dialogs.at(-1);
  return !topDialog || topDialog.contains(scope);
}

export function shouldIgnoreHotkey(event, scope) {
  return Boolean(
    !event ||
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    isEditableHotkeyTarget(event.target) ||
    !isHotkeyScopeActive(scope)
  );
}
