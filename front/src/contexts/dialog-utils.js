import { translateSaved as t } from "../i18n/runtime";

const defaults = {
  alert: () => ({
    title: t("Уведомление"),
    label: "A&D Voice",
    confirmText: t("Понятно"),
    confirmClassName: "btn btn-primary"
  }),
  confirm: () => ({
    title: t("Подтвердите действие"),
    label: t("Требуется подтверждение"),
    confirmText: t("Подтвердить"),
    cancelText: t("Отмена"),
    confirmClassName: "btn btn-primary"
  })
};

export const getDialogCloseResult = (kind) => kind !== "confirm";
export const normalizeDialogOptions = (value) =>
  typeof value === "string"
    ? { title: value }
    : value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
export function createDialogConfig(kind, message, options) {
  const safeKind = kind === "confirm" ? kind : "alert";
  return {
    ...defaults[safeKind](),
    ...normalizeDialogOptions(options),
    kind: safeKind,
    message: String(message ?? "")
  };
}
