import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { api } from "../../../api/client";
import useMountedRef from "../../../hooks/useMountedRef";
import { getErrorMessage } from "../../../utils/errors";
import {
  loadKaraokePreferences,
  normalizeKaraokePreferences,
  saveKaraokePreferences
} from "../utils/preferences";
import useKaraokeRoomPreferences from "./useKaraokeRoomPreferences";

const defaults = normalizeKaraokePreferences({});
const keys = Object.keys(defaults);
const valuesOf = (state) => Object.fromEntries(keys.map((key) => [key, state[key]]));
const setterName = (key) => `set${key[0].toUpperCase()}${key.slice(1)}`;

export const createKaraokePreferencesStore = (saved = loadKaraokePreferences()) =>
  createStore((set) => ({
    ...defaults,
    ...normalizeKaraokePreferences(saved),
    ...Object.fromEntries(
      keys.map((key) => [
        setterName(key),
        (value) =>
          set((state) => ({
            [key]: typeof value === "function" ? value(state[key]) : value
          }))
      ])
    )
  }));

export default function useKaraokePreferences(roomSync = {}) {
  const [store] = useState(createKaraokePreferencesStore);
  const [persistenceError, setPersistenceError] = useState(null);
  const skipPersistence = useRef(false);
  const saveQueue = useRef(Promise.resolve());
  const mounted = useMountedRef();
  const state = useStore(store);

  const setTransient = useCallback(
    (patch) => {
      skipPersistence.current = true;
      store.setState(patch);
    },
    [store]
  );

  useKaraokeRoomPreferences({ ...roomSync, preferences: state, onReceive: setTransient });

  useEffect(
    () =>
      store.subscribe((value) => {
        if (skipPersistence.current) {
          skipPersistence.current = false;
          return;
        }

        const preferences = valuesOf(value);
        if (!saveKaraokePreferences(preferences)) return;

        const save = () => api.updateUiPreferences("karaoke", preferences);
        const request = saveQueue.current.then(save, save);
        saveQueue.current = request.catch(() => {});
        request.then(
          () => mounted.current && setPersistenceError(null),
          (error) => mounted.current && setPersistenceError(getErrorMessage(error))
        );
      }),
    [mounted, store]
  );

  const previewPreference = useCallback(
    (key, value) => keys.includes(key) && setTransient({ [key]: value }),
    [setTransient]
  );

  return { ...state, persistenceError, previewPreference };
}
