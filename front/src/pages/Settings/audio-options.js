import { MONITORING_MODES } from "../Karaoke/config";

export const LATENCY_OPTIONS = [
  ["interactive", "Низкая задержка"],
  ["balanced", "Автоматический"],
  ["playback", "Стабильное воспроизведение"]
].map(([value, label]) => ({ value, label }));

export const MONITOR_MODE_OPTIONS = MONITORING_MODES.map(({ id, title }) => ({
  value: id,
  label: title
}));

export const EMPTY_BROWSER_DEVICES = Object.freeze({
  inputs: [],
  outputs: []
});
