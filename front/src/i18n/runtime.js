import { getSavedLanguage } from "../utils/language";
import { messages } from "./messages";
import { translate } from "./translate";

export const translateSaved = (key, values = {}) =>
  translate(messages, getSavedLanguage(), key, values);
