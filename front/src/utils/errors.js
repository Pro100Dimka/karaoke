import { translateSaved } from "../i18n/runtime";

export function getErrorMessage(error, fallback = translateSaved("Произошла ошибка")) {
  const message = typeof error === "string" ? error : error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}
