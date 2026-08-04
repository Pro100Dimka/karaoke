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

  const loadSettings = useCallback(() => {
    dispatch({ type: "LOAD_START" });
    return api
      .getAppSettings()
      .then((payload) => {
        isMounted.current && dispatch({ type: "LOAD_SUCCESS", payload });
        return payload;
      })
      .catch(
        (payload) =>
          isMounted.current && dispatch({ type: "LOAD_ERROR", payload })
      );
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
  useEffect(() => {
    isMounted.current = true;
    loadSettings();
    return () => (isMounted.current = false);
  }, [loadSettings]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}
