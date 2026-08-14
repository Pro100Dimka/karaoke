import { translateSaved } from "../i18n/runtime";
/**
 * Returns a user-facing message for an unknown thrown value.
 * Keeps error handling consistent without assuming every rejection is Error.
 */
export function getErrorMessage(
  error,
  fallback = translateSaved("Произошла ошибка")
) {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (
    error &&
    typeof error === "object" &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  return fallback;
}
