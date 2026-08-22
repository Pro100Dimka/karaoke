import { api } from "../api/client";

let currentUser = null;
const limited = (value, limit) => (value == null ? undefined : String(value).slice(0, limit));
export const setErrorReporterUser = (name) => {
  currentUser = String(name ?? "").trim() || null;
};
export function reportClientError(
  message,
  { source = "renderer", level = "error", stack, url } = {}
) {
  try {
    Promise.resolve(
      api.reportClientLog({
        source,
        level,
        message: limited(message ?? "unknown error", 2000),
        stack: limited(stack, 4000),
        url: url ?? globalThis.location?.href,
        user: currentUser
      })
    ).catch(() => {});
  } catch {
    // Reporting must never cause another renderer failure.
  }
}
export function installGlobalErrorReporting() {
  if (!globalThis.window || window.__advoiceErrorReporterInstalled) return;
  window.__advoiceErrorReporterInstalled = true;
  window.addEventListener("error", ({ message, error, filename, lineno, colno }) =>
    reportClientError(message || "window error", {
      stack: error?.stack,
      url: filename ? `${filename}:${lineno}:${colno}` : undefined
    })
  );
  window.addEventListener("unhandledrejection", ({ reason }) =>
    reportClientError(reason?.message ?? reason ?? "unhandled rejection", { stack: reason?.stack })
  );
}
