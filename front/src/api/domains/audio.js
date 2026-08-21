import { request } from "../core";

export const audioApi = {
  listAudioDevices: () => request("/audio/devices"),
  listAudioOutputDevices: () => request("/audio/output-devices"),
  listAsioDrivers: () => request("/audio/asio-drivers"),
  getAudioSettings: () => request("/audio/settings"),
  updateAudioSettings: (patch) =>
    request("/audio/settings", { method: "POST", body: JSON.stringify(patch) }),
  startDirectMonitoring: ({ disabledEffects = false } = {}) =>
    request(`/audio/direct-monitor/start?disabled_effects=${disabledEffects}`, { method: "POST" }),
  stopDirectMonitoring: () => request("/audio/direct-monitor/stop", { method: "POST" }),
  releaseDirectMonitoring: () =>
    request("/audio/direct-monitor/stop", { method: "POST", keepalive: true }).catch(() => null),
  getSignalQuality: () => request("/audio/signal-quality")
};
