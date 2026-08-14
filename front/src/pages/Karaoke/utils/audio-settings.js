function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "off", "no"].includes(normalized)) return false;
  }
  return Boolean(value);
}

function normalizeDeviceId(value) {
  return typeof value === "string" || typeof value === "number" ? value : "";
}

export function normalizeAudioEffects(settings) {
  return {
    reverb: Math.max(0, Math.min(1, toFiniteNumber(settings?.reverb))),
    echo: Math.max(0, Math.min(1, toFiniteNumber(settings?.echo))),
    delay: Math.max(0, Math.min(1, toFiniteNumber(settings?.delay)))
  };
}

export function normalizeAudioRuntimeSettings(settings) {
  const bufferSize = Number(settings?.buffer_size);
  return {
    volume: Math.max(0, Math.min(1, toFiniteNumber(settings?.volume))),
    audioDriver:
      typeof settings?.audio_driver === "string" && settings.audio_driver
        ? settings.audio_driver
        : "auto",
    asioDriverName:
      typeof settings?.asio_driver_name === "string"
        ? settings.asio_driver_name
        : "",
    bufferSize:
      Number.isInteger(bufferSize) && bufferSize > 0 ? bufferSize : 64,
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
  const outputs = Array.isArray(devices) ? devices : Array.of();
  const ranked = outputs
    .map((device) => {
      const name = String(device?.name || "").toLowerCase();
      return {
        device,
        score:
          tokens.filter((token) => name.includes(token)).length * 10 +
          (device?.is_asio ? 5 : 0)
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
    (Array.isArray(entries) ? entries : Array.of()).find((entry) => {
      if (entry?.kind !== "audiooutput" || !entry.deviceId) return false;
      const label = String(entry.label || "")
        .trim()
        .toLowerCase();
      return (
        label && (selectedName.includes(label) || label.includes(selectedName))
      );
    }) || null
  );
}

export function groupBrowserAudioDevices(devices) {
  const list = Array.isArray(devices) ? devices : Array.of();
  return {
    inputs: list.filter((device) => device?.kind === "audioinput"),
    outputs: list.filter((device) => device?.kind === "audiooutput")
  };
}
