import { translateSaved as translate } from "../i18n/runtime";

export function getErrorMessage(error, fallback = translate("Произошла ошибка")) {
  const message = typeof error === "string" ? error : error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}
