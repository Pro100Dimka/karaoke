import { getSavedLanguage } from "../utils/language";
import sourceMessages from "./source-messages.json" with { type: "json" };
import { interpolate } from "./translate";

export const translateSaved = (source, values = {}) => {
  const language = getSavedLanguage();
  return interpolate(sourceMessages?.[language]?.[source] ?? source, values);
};
