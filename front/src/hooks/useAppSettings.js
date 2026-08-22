import { useContext } from "react";

import { AppSettingsContext } from "../contexts/app-settings";

export default function useAppSettings() {
  const value = useContext(AppSettingsContext);
  if (!value) throw new Error("useAppSettings must be used inside AppSettingsProvider");
  return value;
}
