import { readJsonStorage, writeJsonStorage } from "./storage";

export const UI_PREFERENCE_STORAGE = Object.freeze({
  audio: "karaoke-audio-preferences",
  karaoke: "karaoke-player-preferences",
  melody_editor: "karaoke-melody-editor",
  radio: "karaoke-radio",
  settings: "karaoke-settings-view"
});

const isObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

const preferenceWrites = new Map();
function queuePreferenceWrite(api, namespace, value) {
  const previous = preferenceWrites.get(namespace) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => api.updateUiPreferences(namespace, value))
    .finally(() => {
      if (preferenceWrites.get(namespace) === next) preferenceWrites.delete(namespace);
    });
  preferenceWrites.set(namespace, next);
  return next;
}

export async function hydrateUiPreferences(api) {
  const remote = await api.getUiPreferences();
  await Promise.all(
    Object.entries(UI_PREFERENCE_STORAGE).map(async ([namespace, key]) => {
      const saved = isObject(remote?.[namespace]) ? remote[namespace] : {};
      if (Object.keys(saved).length) {
        writeJsonStorage(key, saved);
        return;
      }
      const local = readJsonStorage(key);
      if (Object.keys(local).length) await api.updateUiPreferences(namespace, local);
    })
  );
}

export function persistUiPreferences(api, namespace, value) {
  writeJsonStorage(UI_PREFERENCE_STORAGE[namespace], value);
  queuePreferenceWrite(api, namespace, value).catch(() => {});
  return value;
}
