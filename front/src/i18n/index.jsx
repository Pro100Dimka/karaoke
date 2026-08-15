import { createContext, useContext, useLayoutEffect, useMemo } from "react";

import useAppSettings from "../hooks/useAppSettings";
import { translate } from "./translate";
import { messages } from "./messages";

export { messages } from "./messages";

export const I18nContext = createContext(null);

export function translateMessage(language, key, values = {}, fallback = key) {
  return translate(messages, language, key, values, fallback);
}

export function I18nProvider({ children }) {
  const { settings } = useAppSettings();
  const language = messages[settings?.language] ? settings.language : "uk";
  const value = useMemo(
    () => ({
      language,
      t: (key, values = {}, fallback = key) => translateMessage(language, key, values, fallback)
    }),
    [language]
  );

  useLayoutEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
