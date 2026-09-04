import { useEffect, useRef } from "react";

import { useAppDialog } from "../contexts/AppDialog";
import { translateSaved as t } from "../i18n/runtime";
import useAppSettings from "./useAppSettings";

export const getOnlineNameMessage = () => t("room.enterYourNameInTheApplicationSettingsItIs");

export function useRequireOnlineName({ onMissingName } = {}) {
  const { alert } = useAppDialog();
  const { settings, isLoading, error } = useAppSettings();
  const notified = useRef(false);
  useEffect(() => {
    if (
      isLoading ||
      error ||
      !settings ||
      String(settings.online_name ?? "").trim() ||
      notified.current
    )
      return;
    notified.current = true;
    try {
      onMissingName?.();
    } catch {
      // The explanation must still be shown when optional navigation fails.
    }
    Promise.resolve(alert(getOnlineNameMessage())).catch(() => undefined);
  }, [alert, error, isLoading, onMissingName, settings]);
}
