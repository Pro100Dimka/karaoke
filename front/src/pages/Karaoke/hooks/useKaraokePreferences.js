import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { api } from "../../../api/client";
import useMountedRef from "../../../hooks/useMountedRef";
import { getErrorMessage } from "../../../utils/errors";
import useKaraokeRoomPreferences from "./useKaraokeRoomPreferences";
import {
  loadKaraokePreferences,
  normalizeKaraokePreferences,
  saveKaraokePreferences
} from "../utils/preferences";

const defaults = normalizeKaraokePreferences({});
const keys = Object.keys(defaults);
const setterName = (key) => `set${key[0].toUpperCase()}${key.slice(1)}`;
const valuesOf = (state) => Object.fromEntries(keys.map((key) => [key, state[key]]));

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

  useKaraokeRoomPreferences({ ...roomSync, preferences: state });

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
    (key, value) => {
      if (!keys.includes(key)) return;
      skipPersistence.current = true;
      store.setState({ [key]: value });
    },
    [store]
  );

  return { ...state, persistenceError, previewPreference };
}
