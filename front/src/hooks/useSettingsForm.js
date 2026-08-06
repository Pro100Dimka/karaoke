import { useEffect, useRef, useState } from "react";
import useAsyncQueue from "./useAsyncQueue";
import { api } from "../api/client";
import { getErrorMessage } from "../utils/errors";
import { applyTheme } from "../utils/theme";
import {
  mergeSettings,
  prepareSettingValue,
  resolveSavedSetting
} from "./settings-form-utils";

const SAVE_STATUS = {
  IDLE: "idle",
  SAVING: "saving",
  SAVED: "saved"
};

export default function useSettingsForm(notify) {
  const [form, setForm] = useState(null);
  const [saveStatus, setSaveStatus] = useState(SAVE_STATUS.IDLE);
  const mountedRef = useRef(true);
  const saveRequestRef = useRef(0);
  const fieldRequestRef = useRef(new Map());
  const { run: queueSave } = useAsyncQueue();

  useEffect(() => {
    // React Strict Mode mounts, cleans up and mounts effects again in
    // development. Reset the flag in setup so the second mount can still
    // commit successful async results.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveRequestRef.current += 1;
      fieldRequestRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let active = true;

    api
      .getAppSettings()
      .then((settings) => {
        if (active) setForm(settings);
      })
      .catch((error) => {
        if (active) {
          notify(`Не удалось загрузить настройки: ${getErrorMessage(error)}`);
        }
      });

    return () => {
      active = false;
    };
  }, [notify]);

  useEffect(() => {
    if (form?.theme) {
      applyTheme(form.theme);
    }
  }, [form?.theme]);

  const updateField = (name, value) => {
    setSaveStatus(SAVE_STATUS.IDLE);
    setForm((current) => ({ ...current, [name]: value }));
  };

  const save = () => {
    if (!form) return Promise.resolve();

    const payload = form;
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setSaveStatus(SAVE_STATUS.SAVING);

    return queueSave(async () => {
      try {
        const updated = await api.updateAppSettings(payload);
        if (!mountedRef.current || requestId !== saveRequestRef.current) return;

        setForm((current) => mergeSettings(current, updated));
        setSaveStatus(SAVE_STATUS.SAVED);
      } catch (error) {
        if (!mountedRef.current || requestId !== saveRequestRef.current) return;

        setSaveStatus(SAVE_STATUS.IDLE);
        await notify(`Не удалось сохранить: ${getErrorMessage(error)}`);
      }
    });
  };

  const saveField = (name, value) => {
    const preparedValue = prepareSettingValue(value);
    const requestId = (fieldRequestRef.current.get(name) ?? 0) + 1;
    fieldRequestRef.current.set(name, requestId);

    return queueSave(async () => {
      try {
        const updated = await api.updateAppSettings({ [name]: preparedValue });
        if (
          !mountedRef.current ||
          fieldRequestRef.current.get(name) !== requestId
        ) {
          return;
        }

        setForm((current) => ({
          ...current,
          [name]: resolveSavedSetting(updated, name, preparedValue)
        }));
        setSaveStatus(SAVE_STATUS.SAVED);
      } catch (error) {
        if (
          !mountedRef.current ||
          fieldRequestRef.current.get(name) !== requestId
        ) {
          return;
        }

        await notify(`Не удалось сохранить настройку: ${getErrorMessage(error)}`);
      }
    });
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
