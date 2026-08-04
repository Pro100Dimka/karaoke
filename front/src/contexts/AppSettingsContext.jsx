import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { api } from "../api/client";
import { applyTheme, getSavedTheme } from "../utils/theme";

export const AppSettingsContext = createContext(null);

export function AppSettingsProvider({ children }) {
  const mountedRef = useRef(false);
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useLayoutEffect(() => {
    applyTheme(getSavedTheme());
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loadedSettings = await api.getAppSettings();
      if (!mountedRef.current) return null;
      setSettings(loadedSettings);
      applyTheme(loadedSettings?.theme);
      return loadedSettings;
    } catch (requestError) {
      if (mountedRef.current) setError(requestError);
      return null;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSettings = useCallback((nextSettings) => {
    setSettings((currentSettings) => {
      const updatedSettings =
        typeof nextSettings === "function"
          ? nextSettings(currentSettings)
          : nextSettings;
      if (updatedSettings?.theme) applyTheme(updatedSettings.theme);
      return updatedSettings;
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      settings,
      isLoading,
      error,
      updateSettings,
      reloadSettings: loadSettings
    }),
    [settings, isLoading, error, updateSettings, loadSettings]
  );

  return (
    <AppSettingsContext.Provider value={contextValue}>
      {children}
    </AppSettingsContext.Provider>
  );
}
