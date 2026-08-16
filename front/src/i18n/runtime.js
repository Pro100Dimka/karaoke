/* eslint-disable import/extensions */
import { getSavedLanguage } from "../utils/language";
import sourceMessages from "./source-messages.json" with { type: "json" };
import { interpolate } from "./translate";

export const translateSaved = (source, values = {}) => {
  const language = getSavedLanguage();
  if (language === "ru") return interpolate(source, values);
  const message = sourceMessages[language][source] ?? source;
  return interpolate(message, values);
};
