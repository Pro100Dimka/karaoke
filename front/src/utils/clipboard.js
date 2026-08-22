function legacyCopy(text) {
  if (!globalThis.document?.body) return false;
  const field = document.createElement("textarea");
  Object.assign(field, { value: text, readOnly: true });
  Object.assign(field.style, { position: "fixed", opacity: "0", pointerEvents: "none" });
  document.body.append(field);
  field.select();
  try {
    return Boolean(document.execCommand("copy"));
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
export async function copyText(value) {
  const text = String(value ?? "");
  if (!text) return false;
  const electronCopy = globalThis.electronAPI?.copyText ?? globalThis.window?.electronAPI?.copyText;
  if (typeof electronCopy === "function") {
    try {
      return Boolean(await electronCopy(text));
    } catch {
      // Browser transports remain available when IPC itself fails.
    }
  }
  const browserCopy = globalThis.navigator?.clipboard?.writeText;
  if (typeof browserCopy === "function")
    try {
      await browserCopy.call(globalThis.navigator.clipboard, text);
      return true;
    } catch {
      // Fall back to the legacy browser transport.
    }
  return legacyCopy(text);
}
