import { translateSaved } from "../i18n/runtime";

export const DIALOG_DEFAULTS = Object.freeze({
  confirm: Object.freeze({
    title: translateSaved("Подтвердите действие"),
    label: translateSaved("Требуется подтверждение"),
    confirmText: translateSaved("Подтвердить"),
    cancelText: translateSaved("Отмена"),
    confirmClassName: "btn btn-primary"
  }),
  alert: Object.freeze({
    title: translateSaved("Уведомление"),
    label: "A&D Voice",
    confirmText: translateSaved("Понятно"),
    confirmClassName: "btn btn-primary"
  })
});
export function getDialogCloseResult(kind) {
  return kind !== "confirm";
}
export function normalizeDialogOptions(value) {
  if (typeof value === "string")
    return {
      title: value
    };
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
export function createDialogConfig(kind, message, options = {}) {
  const safeKind = kind === "confirm" ? "confirm" : "alert";
  const defaults = DIALOG_DEFAULTS[safeKind];
  const safeOptions = normalizeDialogOptions(options);
  return {
    ...defaults,
    ...safeOptions,
    kind: safeKind,
    message: typeof message === "string" ? message : String(message ?? "")
  };
}
