import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createStore } from "zustand/vanilla";
import { api } from "../../../api/client";
import { loadKaraokePreferences, saveKaraokePreferences } from "../utils/preferences";

const defaults = {
  musicVolume: 1,
  vocalVolume: 1,
  melodyVolume: 0,
  speed: 1,
  keyShift: 0,
  showLyrics: true,
  showNotes: true,
  autoHideConsole: true,
  effectPreset: "studio",
  timingOffsets: {}
};
const keys = Object.keys(defaults);
const setterName = (key) => `set${key[0].toUpperCase()}${key.slice(1)}`;

export const createKaraokePreferencesStore = (saved = loadKaraokePreferences()) =>
  createStore((set) => ({
    ...defaults,
    ...saved,
    ...Object.fromEntries(keys.map((key) => [setterName(key), (value) => set({ [key]: value })]))
  }));

const preferencesOf = (state) => Object.fromEntries(keys.map((key) => [key, state[key]]));

export default function useKaraokePreferences() {
  const [store] = useState(createKaraokePreferencesStore);
  const state = useStore(
    store,
    useShallow((value) => value)
  );

  useEffect(
    () =>
      store.subscribe((value) => {
        const preferences = preferencesOf(value);
        if (saveKaraokePreferences(preferences))
          api.updateUiPreferences("karaoke", preferences).catch(() => {});
      }),
    [store]
  );

  return state;
}
