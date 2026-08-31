import { translateSaved } from "../i18n/runtime";

const normalize = (name) => String(name || "").toLocaleLowerCase().replace(/\s*\[[^\]]+\]\s*$/, "").trim();

export async function resolveMicrophoneDevice(settings) {
  if (settings?.input_device_id == null) return "";
  const selected = normalize(settings.input_device_name);
  const entries = await navigator.mediaDevices.enumerateDevices();
  const inputs = entries.filter((entry) => entry.kind === "audioinput" && entry.deviceId !== "default" && entry.deviceId !== "communications");
  const exact = inputs.filter((entry) => normalize(entry.label) === selected);
  const matches = exact.length ? exact : inputs.filter((entry) => selected && normalize(entry.label).startsWith(`${selected} (`));
  if (matches.length === 1) return matches[0].deviceId;
  throw new Error(translateSaved("room.audio.selectedInputUnavailable"));
}
