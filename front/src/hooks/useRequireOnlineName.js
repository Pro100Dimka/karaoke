import { useEffect, useRef } from "react";
import { useAppDialog } from "../contexts/AppDialog";
import useAppSettings from "./useAppSettings";

const ONLINE_NAME_MESSAGE =
  "Укажите своё имя в настройках приложения. Оно нужно для совместного исполнения и будет видно участникам комнаты.";

export function useRequireOnlineName({ onMissingName }) {
  const { alert } = useAppDialog();
  const { settings, isLoading, error } = useAppSettings();
  const notificationShownRef = useRef(false);

  useEffect(() => {
    if (
      isLoading ||
      error ||
      !settings ||
      settings.online_name?.trim() ||
      notificationShownRef.current
    ) {
      return;
    }

    notificationShownRef.current = true;
    try {
      onMissingName?.();
    } catch {
      // Navigation callbacks must not prevent the explanatory dialog.
    }
    Promise.resolve(alert(ONLINE_NAME_MESSAGE)).catch(() => {});
  }, [alert, error, isLoading, onMissingName, settings]);
}
