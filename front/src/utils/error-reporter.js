// Forwards renderer errors to the backend so they land in the same
// backend.log file as everything else, instead of only ever reaching
// devtools. Best-effort throughout: a failed report must never itself
// throw or recurse back into the error-reporting path.
import { api } from "../api/client";

let currentUser = null;

export function setErrorReporterUser(name) {
  currentUser = String(name || "").trim() || null;
}

const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 4000;

export function reportClientError(
  message,
  { source = "renderer", level = "error", stack, url } = {}
) {
  const payload = {
    source,
    level,
    message: String(message ?? "unknown error").slice(0, MAX_MESSAGE_LENGTH),
    stack: stack ? String(stack).slice(0, MAX_STACK_LENGTH) : undefined,
    url: url || (typeof window !== "undefined" ? window.location?.href : undefined),
    user: currentUser
  };
  try {
    api.reportClientLog(payload).catch(() => {});
  } catch {
    // fetch may be unavailable this early in boot; dropping the report is fine.
  }
}

export function installGlobalErrorReporting() {
  if (typeof window === "undefined" || window.__advoiceErrorReporterInstalled) return;
  window.__advoiceErrorReporterInstalled = true;

  window.addEventListener("error", (event) => {
    reportClientError(event.message || "window error", {
      stack: event.error?.stack,
      url: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const { reason } = event;
    reportClientError(reason?.message || String(reason ?? "unhandled rejection"), {
      stack: reason?.stack
    });
  });
}
