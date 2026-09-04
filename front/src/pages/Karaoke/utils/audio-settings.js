import { clamp, clamp01 } from "../../../utils/math";

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const clamp02 = (value) => clamp(value, 0, 2);

function toBoolean(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(normalized)) return false;
  }
  return Boolean(value);
}

function normalizeDeviceId(value) {
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

export function normalizeAudioEffects(settings) {
  return {
    reverb: clamp01(toFiniteNumber(settings?.reverb)),
    echo: clamp01(toFiniteNumber(settings?.echo)),
    delay: clamp01(toFiniteNumber(settings?.delay)),
    noise_suppression: clamp01(toFiniteNumber(settings?.noise_suppression, 0.35)),
    octave: clamp(toFiniteNumber(settings?.octave), -1, 1)
  };
}

export function normalizeAudioRuntimeSettings(settings) {
  const bufferSize = Number(settings?.buffer_size);
  return {
    volume: clamp02(toFiniteNumber(settings?.volume)),
    audioDriver:
      typeof settings?.audio_driver === "string" && settings.audio_driver
        ? settings.audio_driver
        : "auto",
    asioDriverName: typeof settings?.asio_driver_name === "string" ? settings.asio_driver_name : "",
    bufferSize: Number.isInteger(bufferSize) && bufferSize > 0 ? bufferSize : 64,
    monitoringEnabled: toBoolean(settings?.monitoring_enabled),
    outputDeviceId: normalizeDeviceId(settings?.output_device_id)
  };
}

export function findDriverOutputDevice(devices, driverName) {
  const tokens = String(driverName || "")
    .toLowerCase()
    .replaceAll(/\b(?:asio|driver)\b/g, "")
    .split(/\s/)
    .filter((token) => token.length > 2);
  const outputs = Array.isArray(devices) ? devices : [];
  const ranked = outputs
    .map((device) => {
      const name = String(device?.name || "").toLowerCase();
      return {
        device,
        score:
          tokens.filter((token) => name.includes(token)).length * 10 + (device?.is_asio ? 5 : 0)
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.device ?? null;
}

export function findMatchingBrowserOutput(entries, selectedDevice) {
  const selectedName = String(selectedDevice?.name || "")
    .trim()
    .toLowerCase();
  if (!selectedName) return null;
  return (
    (Array.isArray(entries) ? entries : []).find((entry) => {
      if (entry?.kind !== "audiooutput" || !entry.deviceId) return false;
      const label = String(entry.label || "")
        .trim()
        .toLowerCase();
      return label && (selectedName.includes(label) || label.includes(selectedName));
    }) || null
  );
}
