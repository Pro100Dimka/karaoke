import { isRecord, readJsonStorage, writeJsonStorage } from "./storage";

export const UI_PREFERENCE_STORAGE = Object.freeze({
  audio: "karaoke-audio-preferences",
  karaoke: "karaoke-player-preferences",
  melody_editor: "karaoke-melody-editor",
  radio: "karaoke-radio",
  settings: "karaoke-settings-view"
});
export async function hydrateUiPreferences(api) {
  const remote = await api.getUiPreferences();
  await Promise.all(
    Object.entries(UI_PREFERENCE_STORAGE).map(async ([namespace, key]) => {
      const saved = isRecord(remote?.[namespace]) ? remote[namespace] : {};
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
  const key = UI_PREFERENCE_STORAGE[namespace];
  if (key) writeJsonStorage(key, value);
  Promise.resolve(api.updateUiPreferences(namespace, value)).catch(() => {});
  return value;
}
