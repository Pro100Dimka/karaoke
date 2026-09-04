// Стабильный публичный API. Доменные модули разделяют реализацию, но все
// существующие импорты `api` продолжают работать без изменений.
import { audioApi } from "./domains/audio";
import { playerApi } from "./domains/player";
import { recordingsApi } from "./domains/recordings";
import { settingsApi } from "./domains/settings";
import { songsApi } from "./domains/songs";
import { systemApi } from "./domains/system";

export const api = Object.freeze({
  ...songsApi,
  ...playerApi,
  ...recordingsApi,
  ...systemApi,
  ...audioApi,
  ...settingsApi
});
