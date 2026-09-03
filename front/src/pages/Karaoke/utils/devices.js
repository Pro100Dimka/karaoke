import { translateSaved } from "../../../i18n/runtime";

function mapDeviceOptions(devices, getValue, fallbackLabel) {
  const seen = new Set();
  // Stryker disable next-line ArrayDeclaration: injected primitive is filtered.
  return (Array.isArray(devices) ? devices : [])
    .filter(Boolean)
    .map((device) => ({
      value: getValue(device),
      label: device.name || device.label || fallbackLabel
    }))
    .filter((option) => {
      if (option.value == null || option.value === "" || seen.has(option.value)) {
        return false;
      }
      seen.add(option.value);
      return true;
    });
}
export function createIndexedDeviceOptions(
  devices,
  defaultLabel = translateSaved("library.sort.relevance")
) {
  return [
    { value: "", label: defaultLabel },
    ...mapDeviceOptions(devices, (device) => device.index, translateSaved("karaoke.device"))
  ];
}

const INPUT_AUXILIARY_PATTERN =
  /sound mapper|primary sound capture|первичн(?:ый|ий).*драйвер.*запис|loop[ -]?back|stereo mix|what u hear|s\/?pdif|adat/i;
const OUTPUT_AUXILIARY_PATTERN =
  /sound mapper|primary sound driver|первичн(?:ый|ий).*звуков.*драйвер|первичн(?:ое|ий).*устройств.*вывод/i;
const HOST_SUFFIX_PATTERN = /\s+\[(?:MME|ASIO|Windows (?:WASAPI|DirectSound|WDM-KS))\]\s*$/i;

function hostPriority(device) {
  const host = String(device?.host_api || "").toLowerCase();
  if (host.includes("wasapi")) return 0;
  if (host.includes("asio")) return 1;
  if (host.includes("directsound")) return 2;
  if (host.includes("mme")) return 3;
  if (host.includes("wdm-ks")) return 4;
  return 5;
}

export function createInputDeviceOptions(
  devices,
  selectedDeviceId,
  defaultLabel = translateSaved("library.sort.relevance")
) {
  const selected = Number(selectedDeviceId);
  const hasSelected =
    selectedDeviceId !== null && selectedDeviceId !== "" && Number.isInteger(selected);
  const choices = new Map();

  (Array.isArray(devices) ? devices : []).filter(Boolean).forEach((device) => {
    const index = Number(device?.index);
    if (!Number.isInteger(index)) return;
    const fullName = String(device?.name || device?.label || "").trim();
    const label = fullName.replace(HOST_SUFFIX_PATTERN, "").trim();
    const isSelected = hasSelected && index === selected;
    const isAuxiliary =
      INPUT_AUXILIARY_PATTERN.test(label) ||
      String(device?.host_api || "")
        .toLowerCase()
        .includes("wdm-ks");
    if (isAuxiliary && !isSelected) return;

    const key = label.toLocaleLowerCase() || `device-${index}`;
    const current = choices.get(key);
    const currentSelected = hasSelected && Number(current?.index) === selected;
    if (
      !current ||
      isSelected ||
      (!currentSelected && hostPriority(device) < hostPriority(current))
    ) {
      choices.set(key, { ...device, index, name: label || translateSaved("karaoke.device") });
    }
  });

  return createIndexedDeviceOptions([...choices.values()], defaultLabel);
}

export function createOutputDeviceOptions(
  devices,
  selectedDeviceId,
  driver = "auto",
  defaultLabel = translateSaved("karaoke.systemDevice")
) {
  const selected = Number(selectedDeviceId);
  const hasSelected =
    selectedDeviceId !== null && selectedDeviceId !== "" && Number.isInteger(selected);
  const candidates = (Array.isArray(devices) ? devices : [])
    .filter(Boolean)
    .map((device) => {
      const index = Number(device?.index);
      const fullName = String(device?.name || device?.label || "").trim();
      return {
        ...device,
        index,
        name: fullName.replace(HOST_SUFFIX_PATTERN, "").trim()
      };
    })
    .filter(
      (device) =>
        Number.isInteger(device.index) &&
        Number(device?.max_output_channels ?? 1) > 0 &&
        !OUTPUT_AUXILIARY_PATTERN.test(device.name) &&
        !String(device?.host_api || "")
          .toLowerCase()
          .includes("wdm-ks")
    );

  const requestedHost = driver === "asio" ? "asio" : "wasapi";
  const preferredHost = candidates.some((device) =>
    String(device?.host_api || "")
      .toLowerCase()
      .includes(requestedHost)
  )
    ? requestedHost
    : ["wasapi", "asio", "directsound", "mme"].find((host) =>
        candidates.some((device) =>
          String(device?.host_api || "")
            .toLowerCase()
            .includes(host)
        )
      );

  const choices = new Map();
  candidates.forEach((device) => {
    const host = String(device?.host_api || "").toLowerCase();
    const isSelected =
      hasSelected && device.index === selected && (driver !== "asio" || host.includes("asio"));
    if (preferredHost && !host.includes(preferredHost) && !isSelected) return;

    const key = device.name.toLocaleLowerCase() || `device-${device.index}`;
    const current = choices.get(key);
    const currentSelected = hasSelected && Number(current?.index) === selected;
    if (
      !current ||
      isSelected ||
      (!currentSelected && hostPriority(device) < hostPriority(current))
    ) {
      choices.set(key, {
        ...device,
        name: device.name || translateSaved("karaoke.device")
      });
    }
  });

  return createIndexedDeviceOptions([...choices.values()], defaultLabel);
}
export function createBrowserDeviceOptions(
  devices,
  fallbackLabel,
  defaultLabel = translateSaved("karaoke.systemDefault")
) {
  return [
    { value: "default", label: defaultLabel },
    ...mapDeviceOptions(devices, (device) => device.deviceId, fallbackLabel)
  ];
}
export function createBufferSizeOptions(values = [32, 64, 128, 256, 512]) {
  // Stryker disable next-line ArrayDeclaration: injected primitive becomes NaN.
  return [...new Set((Array.isArray(values) ? values : []).map(Number))]
    .filter((value) => Number.isInteger(value) && value > 0)
    .map((value) => ({
      value,
      label: `${value} samples`
    }));
}
