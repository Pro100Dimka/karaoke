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
    "settings.open": "Налаштування програми",
    "settings.title": "Налаштування програми",
    "settings.eyebrow": "НАЛАШТУВАННЯ",
    "settings.description": "Налаштуйте звук, вигляд і обробку пісень.",
    "settings.sections": "Розділи налаштувань",
    "settings.loading": "Завантажуємо налаштування…",
    "settings.back": "Назад",
    "settings.openAction": "Відкрити →",
    "settings.advanced.show": "Додаткові налаштування",
    "settings.advanced.hide": "Сховати додаткові налаштування",
    "settings.tab.appearance": "Загальне",
    "settings.tab.audio": "Звук",
    "settings.tab.ai": "Обробка",
    "settings.appearance.online_name.label": "Ім’я в мережі",
    "settings.appearance.online_name.tooltip":
      "Це ім’я бачать учасники кімнати",
    "settings.appearance.language.label": "Мова",
    "settings.appearance.language.tooltip": "Мова інтерфейсу програми",
    "settings.appearance.theme.label": "Тема",
    "settings.appearance.theme.tooltip": "Кольорове оформлення програми",
    "settings.appearance.stationId.label": "Радіостанція",
    "settings.appearance.stationId.tooltip": "Фонова музика бібліотеки",
    "settings.appearance.volume.label": "Гучність",
    "settings.appearance.volume.tooltip": "Гучність фонової музики",
    "settings.audio.input_device_id.label": "Мікрофон",
    "settings.audio.input_device_id.tooltip": "Пристрій запису голосу",
    "settings.audio.output_device_id.label": "Динаміки або навушники",
    "settings.audio.output_device_id.tooltip": "Пристрій відтворення звуку",
    "settings.audio.audio_driver.label": "Режим звуку",
    "settings.audio.audio_driver.tooltip":
      "Автоматичний режим підходить більшості користувачів",
    "settings.audio.asio_driver_name.label": "ASIO-драйвер",
    "settings.audio.asio_driver_name.tooltip": "Лише для ручного режиму ASIO",
    "settings.audio.buffer_size.label": "Аудіобуфер",
    "settings.audio.buffer_size.tooltip":
      "Менше — нижча затримка, але вищий ризик клацань",
    "settings.audio.monitorInputDeviceId.label": "Мікрофон для перевірки",
    "settings.audio.monitorInputDeviceId.tooltip":
      "Мікрофон браузерного індикатора рівня",
    "settings.audio.monitorOutputDeviceId.label": "Вихід для перевірки",
    "settings.audio.monitorOutputDeviceId.tooltip":
      "Пристрій тестового сигналу",
    "settings.audio.monitorLatencyHint.label": "Режим затримки",
    "settings.audio.monitorLatencyHint.tooltip":
      "Автоматичного режиму достатньо у більшості випадків",
    "settings.audio.monitorMode.label": "Режим прослуховування",
    "settings.audio.monitorMode.tooltip": "Як повертати голос у навушники",
    "settings.audio.speakerTest.label": "Перевірити звук",
    "settings.audio.speakerTest.tooltip": "Відтворити короткий тестовий сигнал",
    "settings.audio.monitoringEnabled.label": "Чути свій голос",
    "settings.audio.monitoringEnabled.tooltip":
      "Пряме прослуховування мікрофона",
    "settings.audio.volume.label": "Гучність голосу",
    "settings.audio.volume.tooltip": "Гучність голосу під час прослуховування",
    "settings.ai.compute_mode.label": "Пристрій обробки",
    "settings.ai.compute_mode.tooltip":
      "Авто використовує NVIDIA CUDA за наявності, інакше CPU",
    "settings.ai.thread_count.label": "Потоки процесора",
    "settings.ai.thread_count.tooltip":
      "Менше потоків знижує навантаження на слабких ПК",
    "settings.ai.songs_folder.label": "Пісні",
    "settings.ai.songs_folder.tooltip": "Папка бібліотеки пісень",
    "settings.ai.ai_folder.label": "AI-моделі",
    "settings.ai.ai_folder.tooltip": "Папка локальних AI-моделей",
    "settings.ai.cache_folder.label": "Кеш",
    "settings.ai.cache_folder.tooltip": "Папка тимчасових файлів",
    "settings.ai.models.title": "AI-моделі",
    "settings.ai.models.ready": "Усі моделі встановлено та перевірено.",
    "settings.ai.models.missing": "Відсутні або пошкоджені моделі: {count}.",
    "settings.ai.models.downloading":
      "Завантажуємо: {model}. Уже готові файли не завантажуються повторно.",
    "settings.ai.models.preparing": "підготовка",
    "settings.ai.models.progress": "Готовність AI-моделей",
    "settings.ai.models.button": "Завантажити відсутні моделі",
    "settings.ai.models.buttonDownloading": "Завантаження…",
    "settings.option.language.uk": "Українська",
    "settings.option.language.ru": "Російська",
    "settings.option.language.en": "English",
    "settings.option.theme.dark": "Темна",
    "settings.option.theme.light": "Світла",
    "settings.option.theme.green": "Зелена",
    "settings.option.theme.violet": "Фіолетова",
    "settings.option.compute_mode.auto": "Автоматично · рекомендовано",
    "settings.option.compute_mode.cuda": "NVIDIA CUDA",
    "settings.option.compute_mode.cpu": "Лише процесор"
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
    "settings.open": "Настройки приложения",
    "settings.title": "Настройки приложения",
    "settings.eyebrow": "НАСТРОЙКИ",
    "settings.description": "Настройте звук, внешний вид и обработку песен.",
    "settings.sections": "Разделы настроек",
    "settings.loading": "Загружаем настройки…",
    "settings.back": "Назад",
    "settings.openAction": "Открыть →",
    "settings.advanced.show": "Дополнительные настройки",
    "settings.advanced.hide": "Скрыть дополнительные настройки",
    "settings.tab.appearance": "Общее",
    "settings.tab.audio": "Звук",
    "settings.tab.ai": "Обработка",
    "settings.ai.models.title": "AI-модели",
    "settings.ai.models.ready": "Все модели установлены и проверены.",
    "settings.ai.models.missing": "Отсутствуют или повреждены модели: {count}.",
    "settings.ai.models.downloading":
      "Загружаем: {model}. Уже готовые файлы повторно не скачиваются.",
    "settings.ai.models.preparing": "подготовка",
    "settings.ai.models.progress": "Готовность AI-моделей",
    "settings.ai.models.button": "Скачать недостающие модели",
    "settings.ai.models.buttonDownloading": "Загрузка…"
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
    "settings.open": "Application settings",
    "settings.title": "Application settings",
    "settings.eyebrow": "SETTINGS",
    "settings.description": "Configure audio, appearance, and song processing.",
    "settings.sections": "Settings sections",
    "settings.loading": "Loading settings…",
    "settings.back": "Back",
    "settings.openAction": "Open →",
    "settings.advanced.show": "Advanced settings",
    "settings.advanced.hide": "Hide advanced settings",
    "settings.tab.appearance": "General",
    "settings.tab.audio": "Audio",
    "settings.tab.ai": "Processing",
    "settings.appearance.online_name.label": "Online name",
    "settings.appearance.online_name.tooltip":
      "Room participants can see this name",
    "settings.appearance.language.label": "Language",
    "settings.appearance.language.tooltip": "Application interface language",
    "settings.appearance.theme.label": "Theme",
    "settings.appearance.theme.tooltip": "Application color theme",
    "settings.appearance.stationId.label": "Radio station",
    "settings.appearance.stationId.tooltip": "Library background music",
    "settings.appearance.volume.label": "Volume",
    "settings.appearance.volume.tooltip": "Background music volume",
    "settings.audio.input_device_id.label": "Microphone",
    "settings.audio.input_device_id.tooltip": "Voice recording device",
    "settings.audio.output_device_id.label": "Speakers or headphones",
    "settings.audio.output_device_id.tooltip": "Audio output device",
    "settings.audio.audio_driver.label": "Audio mode",
    "settings.audio.audio_driver.tooltip":
      "Automatic mode is suitable for most users",
    "settings.audio.asio_driver_name.label": "ASIO driver",
    "settings.audio.asio_driver_name.tooltip": "Only used in manual ASIO mode",
    "settings.audio.buffer_size.label": "Audio buffer",
    "settings.audio.buffer_size.tooltip":
      "Smaller means lower latency but a higher click risk",
    "settings.audio.monitorInputDeviceId.label": "Test microphone",
    "settings.audio.monitorInputDeviceId.tooltip":
      "Microphone used by the browser level meter",
    "settings.audio.monitorOutputDeviceId.label": "Test output",
    "settings.audio.monitorOutputDeviceId.tooltip":
      "Device used for the test signal",
    "settings.audio.monitorLatencyHint.label": "Latency mode",
    "settings.audio.monitorLatencyHint.tooltip":
      "Automatic mode is sufficient in most cases",
    "settings.audio.monitorMode.label": "Monitoring mode",
    "settings.audio.monitorMode.tooltip":
      "How your voice is returned to the headphones",
    "settings.audio.speakerTest.label": "Test audio",
    "settings.audio.speakerTest.tooltip": "Play a short test signal",
    "settings.audio.monitoringEnabled.label": "Hear my voice",
    "settings.audio.monitoringEnabled.tooltip": "Direct microphone monitoring",
    "settings.audio.volume.label": "Voice volume",
    "settings.audio.volume.tooltip": "Voice monitoring volume",
    "settings.ai.compute_mode.label": "Processing device",
    "settings.ai.compute_mode.tooltip":
      "Auto uses NVIDIA CUDA when available, otherwise CPU",
    "settings.ai.thread_count.label": "CPU threads",
    "settings.ai.thread_count.tooltip":
      "Fewer threads reduce load on slower computers",
    "settings.ai.songs_folder.label": "Songs",
    "settings.ai.songs_folder.tooltip": "Song library folder",
    "settings.ai.ai_folder.label": "AI models",
    "settings.ai.ai_folder.tooltip": "Local AI model folder",
    "settings.ai.cache_folder.label": "Cache",
    "settings.ai.cache_folder.tooltip": "Temporary file folder",
    "settings.ai.models.title": "AI models",
    "settings.ai.models.ready": "All models are installed and verified.",
    "settings.ai.models.missing": "Missing or damaged models: {count}.",
    "settings.ai.models.downloading":
      "Downloading: {model}. Completed files will not be downloaded again.",
    "settings.ai.models.preparing": "preparing",
    "settings.ai.models.progress": "AI model readiness",
    "settings.ai.models.button": "Download missing models",
    "settings.ai.models.buttonDownloading": "Downloading…",
    "settings.option.language.uk": "Ukrainian",
    "settings.option.language.ru": "Russian",
    "settings.option.language.en": "English",
    "settings.option.theme.dark": "Dark",
    "settings.option.theme.light": "Light",
    "settings.option.theme.green": "Green",
    "settings.option.theme.violet": "Violet",
    "settings.option.compute_mode.auto": "Automatic · recommended",
    "settings.option.compute_mode.cuda": "NVIDIA CUDA",
    "settings.option.compute_mode.cpu": "CPU only"
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
      t: (key, values = {}, fallback = key) => {
        const translated = messages[language][key];
        const sourceFallback = fallback !== key ? fallback : undefined;
        const message =
          translated ??
          (language === "ru" ? sourceFallback : undefined) ??
          messages.uk[key] ??
          sourceFallback ??
          key;
        return interpolate(message, values);
      }
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
