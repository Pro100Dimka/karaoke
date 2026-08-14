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
import { getSavedLanguage, saveLanguage } from "../utils/language";
import { applyTheme, getSavedTheme } from "../utils/theme";

export const AppSettingsContext = createContext(null);
export const INITIAL_APP_SETTINGS_STATE = Object.freeze({
  settings: null,
  isLoading: true,
  error: null
});

export function appSettingsReducer(state, { type, payload }) {
  if (type === "LOAD_START") return { ...state, isLoading: true, error: null };
  if (type === "LOAD_SUCCESS")
    return { ...state, settings: payload, isLoading: false, error: null };
  if (type === "LOAD_ERROR")
    return { ...state, isLoading: false, error: payload };
  if (type === "UPDATE_SETTINGS") {
    return {
      ...state,
      settings:
        typeof payload === "function" ? payload(state.settings) : payload
    };
  }
  return state;
}

export default function AppSettingsProvider({ children }) {
  const [state, dispatch] = useReducer(
    appSettingsReducer,
    INITIAL_APP_SETTINGS_STATE
  );
  const loadRequestRef = useRef();

  // The callback closes only over stable React dispatch/refs.
  // Stryker disable ArrayDeclaration
  const loadSettings = useCallback(() => {
    const requestId = Symbol("settings-request");
    loadRequestRef.current = requestId;
    dispatch({ type: "LOAD_START" });

    return api
      .getAppSettings()
      .then((payload) => {
        if (requestId === loadRequestRef.current) {
          dispatch({ type: "LOAD_SUCCESS", payload });
        }
        return payload;
      })
      .catch((payload) => {
        if (requestId === loadRequestRef.current) {
          dispatch({ type: "LOAD_ERROR", payload });
        }
        throw payload;
      });
  }, []);
  // Stryker restore ArrayDeclaration
  const value = useMemo(
    () => ({
      ...state,
      updateSettings: (payload) =>
        dispatch({ type: "UPDATE_SETTINGS", payload }),
      reloadSettings: loadSettings
    }),
    [state, loadSettings]
  );

  useLayoutEffect(() => {
    applyTheme(state.settings?.theme ?? getSavedTheme());
  }, [state.settings?.theme]);
  useLayoutEffect(() => {
    if (!state.settings?.language) return;
    const previous = getSavedLanguage();
    const current = saveLanguage(state.settings.language);
    if (previous !== current) globalThis.location.reload();
  }, [state.settings?.language]);
  // loadSettings is stable for the provider lifetime.
  // Stryker disable ArrayDeclaration
  useEffect(() => {
    loadSettings().catch(() => {});
  }, [loadSettings]);
  // Stryker restore ArrayDeclaration

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
