import { createContext, useContext, useLayoutEffect, useMemo } from "react";

import useAppSettings from "../hooks/useAppSettings";

const messages = {
  uk: {
    "audio.mute": "Вимкнути звук",
    "audio.pause": "Пауза",
    "audio.playRecording": "Відтворити запис",
    "audio.recordingPosition": "Позиція запису",
    "audio.recordingVolume": "Гучність запису",
    "audio.unmute": "Увімкнути звук",
    "common.closeWindow": "Закрити вікно",
    "common.minimizeWindow": "Згорнути вікно",
    "error.screen.body": "Спробуйте відкрити екран ще раз.",
    "error.screen.title": "Не вдалося відкрити екран",
    "radio.disable": "Вимкнути {station}",
    "radio.enable": "Увімкнути {station}",
    "radio.volume": "Гучність радіо",
    "settings.open": "Налаштування програми"
  },
  ru: {
    "audio.mute": "Выключить звук",
    "audio.pause": "Пауза",
    "audio.playRecording": "Воспроизвести запись",
    "audio.recordingPosition": "Позиция записи",
    "audio.recordingVolume": "Громкость записи",
    "audio.unmute": "Включить звук",
    "common.closeWindow": "Закрыть окно",
    "common.minimizeWindow": "Свернуть окно",
    "error.screen.body": "Попробуйте открыть экран ещё раз.",
    "error.screen.title": "Не удалось открыть экран",
    "radio.disable": "Выключить {station}",
    "radio.enable": "Включить {station}",
    "radio.volume": "Громкость радио",
    "settings.open": "Настройки приложения"
  },
  en: {
    "audio.mute": "Mute",
    "audio.pause": "Pause",
    "audio.playRecording": "Play recording",
    "audio.recordingPosition": "Recording position",
    "audio.recordingVolume": "Recording volume",
    "audio.unmute": "Unmute",
    "common.closeWindow": "Close window",
    "common.minimizeWindow": "Minimize window",
    "error.screen.body": "Try opening the screen again.",
    "error.screen.title": "Could not open the screen",
    "radio.disable": "Turn off {station}",
    "radio.enable": "Turn on {station}",
    "radio.volume": "Radio volume",
    "settings.open": "Application settings"
  }
};

const I18nContext = createContext(null);
const interpolate = (message, values) =>
  message.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));

export function I18nProvider({ children }) {
  const { settings } = useAppSettings();
  const language = messages[settings?.language] ? settings.language : "uk";
  const value = useMemo(
    () => ({
      language,
      t: (key, values = {}) =>
        interpolate(messages[language][key] ?? messages.uk[key] ?? key, values)
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
