import { translateSaved as t } from "../i18n/runtime";

const defaults = {
  alert: () => ({
    title: t("common.notification"),
    label: "A&D Voice",
    confirmText: t("common.itSClear"),
    confirmClassName: "btn btn-primary"
  }),
  confirm: () => ({
    title: t("common.confirmAction"),
    label: t("common.confirmationRequired"),
    confirmText: t("common.confirm"),
    cancelText: t("common.cancel"),
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
