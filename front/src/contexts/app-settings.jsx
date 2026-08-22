import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef
} from "react";

import { api } from "../api/client";
import { setErrorReporterUser } from "../utils/error-reporter";
import { getSavedLanguage, saveLanguage } from "../utils/language";
import { applyTheme, getSavedTheme } from "../utils/theme";

export const AppSettingsContext = createContext(null);
export const INITIAL_APP_SETTINGS_STATE = Object.freeze({
  settings: null,
  isLoading: true,
  error: null
});
const reducers = {
  LOAD_START: (state) => ({ ...state, isLoading: true, error: null }),
  LOAD_SUCCESS: (_state, settings) => ({ settings, isLoading: false, error: null }),
  LOAD_ERROR: (state, error) => ({ ...state, isLoading: false, error }),
  UPDATE_SETTINGS: (state, update) => ({
    ...state,
    settings: typeof update === "function" ? update(state.settings) : update
  })
};

export const appSettingsReducer = (state, { type, payload }) =>
  Object.hasOwn(reducers, type) ? reducers[type](state, payload) : state;

export default function AppSettingsProvider({ children }) {
  const [state, dispatch] = useReducer(appSettingsReducer, INITIAL_APP_SETTINGS_STATE);
  const latestLoad = useRef();
  const reloadSettings = useCallback(() => {
    const request = Symbol("settings");
    latestLoad.current = request;
    dispatch({ type: "LOAD_START" });
    return api.getAppSettings().then(
      (payload) => {
        if (latestLoad.current === request) dispatch({ type: "LOAD_SUCCESS", payload });
        return payload;
      },
      (error) => {
        if (latestLoad.current === request) dispatch({ type: "LOAD_ERROR", payload: error });
        throw error;
      }
    );
  }, []);
  const value = useMemo(
    () => ({
      ...state,
      reloadSettings,
      updateSettings: (payload) => dispatch({ type: "UPDATE_SETTINGS", payload })
    }),
    [reloadSettings, state]
  );

  useLayoutEffect(() => {
    applyTheme(state.settings?.theme ?? getSavedTheme());
  }, [state.settings?.theme]);
  useEffect(() => setErrorReporterUser(state.settings?.online_name), [state.settings?.online_name]);
  useLayoutEffect(() => {
    if (!state.settings?.language) return;
    const previous = getSavedLanguage();
    if (saveLanguage(state.settings.language) !== previous) globalThis.location.reload();
  }, [state.settings?.language]);
  useEffect(() => {
    reloadSettings().catch(() => undefined);
  }, [reloadSettings]);

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}
