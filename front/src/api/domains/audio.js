import { request } from "../core";

// The response acknowledges desired state; readiness/errors arrive through
// getDirectMonitorStatus. Keep a transport deadline for busy/older backends.
const DIRECT_MONITOR_START_TIMEOUT_MS = 25_000;

export const audioApi = {
  listAudioDevices: () => request("/audio/devices"),
  listAudioOutputDevices: () => request("/audio/output-devices"),
  listAsioDrivers: () => request("/audio/asio-drivers"),
  getAudioSettings: () => request("/audio/settings"),
  updateAudioSettings: (patch) =>
    request("/audio/settings", { method: "POST", body: JSON.stringify(patch) }),
  getDirectMonitorStatus: () => request("/audio/direct-monitor/status"),
  startDirectMonitoring: ({ disabledEffects = false, wasapiMode, autoBuffer = false } = {}) =>
    request(
      `/audio/direct-monitor/start?disabled_effects=${disabledEffects}${wasapiMode ? `&wasapi_mode=${encodeURIComponent(wasapiMode)}` : ""}${autoBuffer ? "&auto_buffer=true" : ""}`,
      {
        method: "POST",
        timeoutMs: DIRECT_MONITOR_START_TIMEOUT_MS
      }
    ),
  stopDirectMonitoring: () => request("/audio/direct-monitor/stop", { method: "POST" }),
  releaseDirectMonitoring: () =>
    request("/audio/direct-monitor/stop", { method: "POST", keepalive: true }).catch(() => null),
  getSignalQuality: () => request("/audio/signal-quality")
};
