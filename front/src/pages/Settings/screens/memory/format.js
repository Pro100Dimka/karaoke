import { translateSaved } from "../../../../i18n/runtime";

export function formatBytes(bytes = 0) {
  const value = Number(bytes);
  const megabytes = Number.isFinite(value) ? Math.max(0, value) / 1024 ** 2 : 0;
  return translateSaved("{0} МБ", { 0: megabytes.toFixed(1) });
}
