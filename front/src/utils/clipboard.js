function copyWithTextarea(value) {
  if (typeof document === "undefined" || !document.body) return false;

  const input = document.createElement("textarea");
  input.value = value;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.append(input);
  input.select();

  try {
    return Boolean(document.execCommand("copy"));
  } catch {
    return false;
  } finally {
    input.remove();
  }
}

export async function copyText(value) {
  const text = String(value ?? "");
  if (!text) return false;

  try {
    return Boolean(await globalThis.window.electronAPI.copyText(text));
  } catch {
    // Fall through to browser clipboard strategies.
  }

  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard permissions may be denied; use the legacy fallback below.
  }

  return copyWithTextarea(text);
}
