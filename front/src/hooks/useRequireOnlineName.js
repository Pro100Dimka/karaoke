import { useEffect, useRef } from "react";
import { useAppDialog } from "../contexts/AppDialog";
import { translateSaved } from "../i18n/runtime";
import useAppSettings from "./useAppSettings";

function getOnlineNameMessage() {
  return translateSaved(
    "Укажите своё имя в настройках приложения. Оно нужно для совместного исполнения и будет видно участникам комнаты."
  );
}
export function useRequireOnlineName({ onMissingName }) {
  const { alert } = useAppDialog();
  const { settings, isLoading, error } = useAppSettings();
  const notificationShownRef = useRef(false);
  useEffect(() => {
    if (
      isLoading ||
      error ||
      !settings ||
      String(settings.online_name ?? "").trim() ||
      notificationShownRef.current
    ) {
      return;
    }
    notificationShownRef.current = true;
    try {
      onMissingName();
    } catch {
      // Missing or failing navigation callbacks must not hide the explanation.
    }
    Promise.resolve(alert(getOnlineNameMessage())).catch(() => {});
  }, [alert, error, isLoading, onMissingName, settings]);
}
