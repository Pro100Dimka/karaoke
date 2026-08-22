import { createContext, useContext, useLayoutEffect, useMemo } from "react";
import useAppSettings from "../hooks/useAppSettings";
import { messages } from "./messages";
import { translate } from "./translate";

export { messages } from "./messages";
export const I18nContext = createContext(null);
export const translateMessage = (language, key, values = {}, fallback = key) =>
  translate(messages, language, key, values, fallback);
export function I18nProvider({ children }) {
  const { settings } = useAppSettings();
  const language = settings?.language in messages ? settings.language : "uk";
  useLayoutEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(
    () => ({
      language,
      t: (key, values, fallback) => translateMessage(language, key, values, fallback)
    }),
    [language]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
