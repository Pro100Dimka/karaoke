import { translateSaved } from "../../../../i18n/runtime";

export function formatBytes(bytes = 0) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return translateSaved("0.0 МБ");
  return translateSaved("{0} МБ", {
    0: (value / 1024 ** 2).toFixed(1)
  });
}
