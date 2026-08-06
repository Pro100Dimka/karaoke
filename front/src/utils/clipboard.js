function copyWithTextarea(value) {
  if (typeof document === "undefined" || !document.body) return false;

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.append(input);
  input.select();

  try {
    return Boolean(document.execCommand?.("copy"));
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
    if (typeof window !== "undefined" && window.electronAPI?.copyText) {
      return Boolean(await window.electronAPI.copyText(text));
    }
  } catch {
    // Fall through to browser clipboard strategies.
  }

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard permissions may be denied; use the legacy fallback below.
  }

  return copyWithTextarea(text);
}
