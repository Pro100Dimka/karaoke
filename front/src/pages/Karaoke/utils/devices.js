function mapDeviceOptions(devices, getValue, fallbackLabel) {
  const seen = new Set();
  return (Array.isArray(devices) ? devices : [])
    .filter((device) => device && typeof device === "object")
    .map((device) => ({
      value: getValue(device),
      label: device.name || device.label || fallbackLabel
    }))
    .filter((option) => {
      if (
        option.value == null ||
        option.value === "" ||
        seen.has(option.value)
      ) {
        return false;
      }
      seen.add(option.value);
      return true;
    });
}

export function createIndexedDeviceOptions(
  devices,
  defaultLabel = "По умолчанию"
) {
  return [
    { value: "", label: defaultLabel },
    ...mapDeviceOptions(devices, (device) => device?.index, "Устройство")
  ];
}

export function createBrowserDeviceOptions(
  devices,
  fallbackLabel,
  defaultLabel = "Системное по умолчанию"
) {
  return [
    { value: "default", label: defaultLabel },
    ...mapDeviceOptions(devices, (device) => device?.deviceId, fallbackLabel)
  ];
}

export function createBufferSizeOptions(values = [32, 64, 128, 256, 512]) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number))]
    .filter((value) => Number.isInteger(value) && value > 0)
    .map((value) => ({
      value,
      label: `${value} samples`
    }));
}
