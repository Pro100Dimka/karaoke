import { request } from "../core";

// Starting PortAudio on Windows can legitimately take longer than the generic
// HTTP deadline: the backend gives the isolated monitor worker up to 12s and
// may first need to terminate a stale driver process. Keep this deadline above
// the complete backend recovery window so the UI receives the real success or
// the useful device error instead of an unrelated transport timeout.
const DIRECT_MONITOR_START_TIMEOUT_MS = 25_000;

export const audioApi = {
  listAudioDevices: () => request("/audio/devices"),
  listAudioOutputDevices: () => request("/audio/output-devices"),
  listAsioDrivers: () => request("/audio/asio-drivers"),
  getAudioSettings: () => request("/audio/settings"),
  updateAudioSettings: (patch) =>
    request("/audio/settings", { method: "POST", body: JSON.stringify(patch) }),
  startDirectMonitoring: ({ disabledEffects = false } = {}) =>
    request(`/audio/direct-monitor/start?disabled_effects=${disabledEffects}`, {
      method: "POST",
      timeoutMs: DIRECT_MONITOR_START_TIMEOUT_MS
    }),
  stopDirectMonitoring: () => request("/audio/direct-monitor/stop", { method: "POST" }),
  releaseDirectMonitoring: () =>
    request("/audio/direct-monitor/stop", { method: "POST", keepalive: true }).catch(() => null),
  getSignalQuality: () => request("/audio/signal-quality")
};
