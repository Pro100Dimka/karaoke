const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const DEFAULT_RENDERER_ORIGIN = "http://127.0.0.1:5173";
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

function hostname(url) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function loopbackHttpUrl(value, fallback, label) {
  const raw = String(value || fallback).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.includes(hostname(parsed))) {
    throw new Error(`${label} must use HTTP on a loopback host`);
  }
  return parsed.origin;
}

function positiveInteger(value, fallback, label) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

const BACKEND_URL = loopbackHttpUrl(
  process.env.KARAOKE_BACKEND_URL,
  DEFAULT_BACKEND_URL,
  "KARAOKE_BACKEND_URL"
);
const DEV_RENDERER_ORIGIN = loopbackHttpUrl(
  process.env.KARAOKE_RENDERER_ORIGIN,
  DEFAULT_RENDERER_ORIGIN,
  "KARAOKE_RENDERER_ORIGIN"
);

module.exports = Object.freeze({
  BACKEND_URL,
  DEV_RENDERER_ORIGIN,
  BACKEND_HOST: hostname(new URL(BACKEND_URL)),
  BACKEND_PORT: Number(new URL(BACKEND_URL).port || 80),
  BACKEND_REQUEST_TIMEOUT_MS: positiveInteger(
    process.env.KARAOKE_BACKEND_REQUEST_TIMEOUT_MS,
    1200,
    "KARAOKE_BACKEND_REQUEST_TIMEOUT_MS"
  ),
  BACKEND_RESTART_BASE_DELAY_MS: positiveInteger(
    process.env.KARAOKE_BACKEND_RESTART_BASE_DELAY_MS,
    1200,
    "KARAOKE_BACKEND_RESTART_BASE_DELAY_MS"
  ),
  BACKEND_RESTART_MAX_DELAY_MS: positiveInteger(
    process.env.KARAOKE_BACKEND_RESTART_MAX_DELAY_MS,
    30000,
    "KARAOKE_BACKEND_RESTART_MAX_DELAY_MS"
  ),
  BACKEND_STOP_GRACE_MS: positiveInteger(
    process.env.KARAOKE_BACKEND_STOP_GRACE_MS,
    550,
    "KARAOKE_BACKEND_STOP_GRACE_MS"
  )
});
