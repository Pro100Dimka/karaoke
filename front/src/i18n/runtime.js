/* eslint-disable import/extensions */
import { getSavedLanguage } from "../utils/language";
import sourceMessages from "./source-messages.json" with { type: "json" };
import { interpolate } from "./translate";

export const translateSaved = (source, values = {}) => {
  const language = getSavedLanguage();
  return interpolate(
    language === "ru" ? source : (sourceMessages[language]?.[source] ?? source),
    values
  );
};
