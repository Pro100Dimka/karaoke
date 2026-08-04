import { useEffect, useState } from "react";
import { api } from "../api/client";
import { applyTheme } from "../utils/theme";

const SAVE_STATUS = {
  IDLE: "idle",
  SAVING: "saving",
  SAVED: "saved"
};

export default function useSettingsForm(notify) {
  const [form, setForm] = useState(null);
  const [saveStatus, setSaveStatus] = useState(SAVE_STATUS.IDLE);

  useEffect(() => {
    api
      .getAppSettings()
      .then(setForm)
      .catch(({ message }) => {
        notify(`Не удалось загрузить настройки: ${message}`);
      });
  }, [notify]);

  useEffect(() => {
    if (form?.theme) {
      applyTheme(form.theme);
    }
  }, [form?.theme]);

  const updateField = (name, value) => {
    setSaveStatus(SAVE_STATUS.IDLE);

    setForm((current) => ({
      ...current,
      [name]: value
    }));
  };

  const save = async () => {
    if (!form) return;

    setSaveStatus(SAVE_STATUS.SAVING);

    try {
      const updated = await api.updateAppSettings(form);

      setForm((current) => ({
        ...current,
        ...updated
      }));

      setSaveStatus(SAVE_STATUS.SAVED);
    } catch ({ message }) {
      setSaveStatus(SAVE_STATUS.IDLE);
      await notify(`Не удалось сохранить: ${message}`);
    }
  };

  const saveField = async (name, value) => {
    const preparedValue = typeof value === "string" ? value.trim() : value;

    try {
      const updated = await api.updateAppSettings({
        [name]: preparedValue
      });

      setForm((current) => ({
        ...current,
        [name]: updated[name] ?? preparedValue
      }));

      setSaveStatus(SAVE_STATUS.SAVED);
    } catch ({ message }) {
      await notify(`Не удалось сохранить настройку: ${message}`);
    }
  };

  return {
    form,
    saveStatus,
    saving: saveStatus === SAVE_STATUS.SAVING,
    saved: saveStatus === SAVE_STATUS.SAVED,
    updateField,
    saveField,
    save
  };
}
