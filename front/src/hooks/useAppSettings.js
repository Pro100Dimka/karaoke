import { useContext } from "react";
import { AppSettingsContext } from "../contexts/AppSettingsContext";

export default function useAppSettings() {
  const context = useContext(AppSettingsContext);

  if (!context) {
    throw new Error("useAppSettings must be used inside AppSettingsProvider");
  }

  return context;
}
