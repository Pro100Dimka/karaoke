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

const actions = (payload, { settings }) => ({
  LOAD_START: { isLoading: true, error: null },
  LOAD_SUCCESS: { settings: payload, isLoading: false, error: null },
  LOAD_ERROR: { isLoading: false, error: payload },
  UPDATE_SETTINGS: {
    settings: typeof payload === "function" ? payload(settings) : payload
  }
});

const reducer = (state, { type, payload }) => ({
  ...state,
  ...actions(payload, state)?.[type]
});

export default function AppSettingsProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, {
    settings: null,
    isLoading: true,
    error: null
  });
  const isMounted = useRef(false);
  const loadRequestRef = useRef(0);

  const loadSettings = useCallback(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    dispatch({ type: "LOAD_START" });

    return api
      .getAppSettings()
      .then((payload) => {
        if (isMounted.current && requestId === loadRequestRef.current) {
          dispatch({ type: "LOAD_SUCCESS", payload });
        }
        return payload;
      })
      .catch((payload) => {
        if (isMounted.current && requestId === loadRequestRef.current) {
          dispatch({ type: "LOAD_ERROR", payload });
        }
        throw payload;
      });
  }, []);
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
    if (previous !== current) globalThis.location?.reload();
  }, [state.settings?.language]);
  useEffect(() => {
    isMounted.current = true;
    loadSettings().catch(() => {});
    return () => {
      isMounted.current = false;
      loadRequestRef.current += 1;
    };
  }, [loadSettings]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
