import { useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import useAppSettings from "../../../hooks/useAppSettings";
import useAsyncQueue from "../../../hooks/useAsyncQueue";
import useLatestRef from "../../../hooks/useLatestRef";
import useMountedRef from "../../../hooks/useMountedRef";
import { translateSaved } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";
import { applyTheme } from "../../../utils/theme";
import { mergeSettings, prepareSettingValue, resolveSavedSetting } from "./settings-form-utils";

export default function useSettingsForm(notify) {
  const [form, setForm] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle");
  const mountedRef = useMountedRef();
  const saveRequestRef = useRef(null);
  const fieldRequestRef = useRef(new Map());
  const pendingSavesRef = useRef(new Set());
  const saveFailedRef = useRef(false);
  const { run: queueSave } = useAsyncQueue();
  const { updateSettings: updateAppSettings } = useAppSettings();
  const notifyRef = useLatestRef(notify);
  const beginSave = () => {
    const token = Symbol("settings save");
    pendingSavesRef.current.add(token);
    setSaveStatus("saving");
    return token;
  };
  const finishSave = (token, failed) => {
    if (failed) saveFailedRef.current = true;
    pendingSavesRef.current.delete(token);
    // Stryker disable next-line ConditionalExpression: post-unmount update is inert.
    if (!mountedRef.current) return;
    if (pendingSavesRef.current.size) return;
    setSaveStatus(saveFailedRef.current ? "idle" : "saved");
    saveFailedRef.current = false;
  };
  useEffect(
    () => {
      let active = true;
      api
        .getAppSettings()
        .then((settings) => {
          setForm(settings);
        })
        .catch((error) => {
          if (active) {
            notifyRef.current(
              translateSaved("Не удалось загрузить настройки: {0}", { 0: getErrorMessage(error) })
            );
          }
        });
      return () => {
        active = false;
      };
    },
    // Stryker disable next-line ArrayDeclaration: stable latest-value ref.
    [notifyRef]
  );
  useEffect(() => {
    if (form?.theme) applyTheme(form.theme);
  }, [form?.theme]);
  const updateField = (name, value) => {
    setSaveStatus("idle");
    setForm((current) => ({ ...current, [name]: value }));

    // Keep the global settings context in sync with fields that affect the
    // whole application immediately. LibraryHero and other screens read the
    // theme from AppSettingsContext, not from this page-local form.
    if (name === "theme") updateAppSettings((current) => ({ ...current, theme: value }));
  };
  const save = () => {
    if (!form) return Promise.resolve();
    const payload = form;
    const requestToken = beginSave();
    saveRequestRef.current = requestToken;
    return queueSave(async () => {
      let failed = false;
      try {
        const updated = await api.updateAppSettings(payload);
        // Stryker disable next-line ConditionalExpression: post-unmount update is inert.
        if (!mountedRef.current) return;
        if (requestToken !== saveRequestRef.current) return;
        setForm((current) => mergeSettings(current, updated));
        updateAppSettings((current) => mergeSettings(current, updated));
      } catch (error) {
        if (!mountedRef.current) return;
        if (requestToken !== saveRequestRef.current) return;
        failed = true;
        await notifyRef.current(
          translateSaved("Не удалось сохранить: {0}", { 0: getErrorMessage(error) })
        );
      } finally {
        finishSave(requestToken, failed);
      }
    });
  };
  const saveField = (name, value) => {
    const preparedValue = prepareSettingValue(value);
    const requestToken = beginSave();
    fieldRequestRef.current.set(name, requestToken);
    return queueSave(async () => {
      let failed = false;
      try {
        const updated = await api.updateAppSettings({ [name]: preparedValue });
        // Stryker disable next-line ConditionalExpression: post-unmount update is inert.
        if (!mountedRef.current) return;
        if (fieldRequestRef.current.get(name) !== requestToken) return;
        const savedValue = resolveSavedSetting(updated, name, preparedValue);
        setForm((current) => ({ ...current, [name]: savedValue }));
        updateAppSettings((current) => ({ ...current, [name]: savedValue }));
      } catch (error) {
        if (!mountedRef.current) return;
        if (fieldRequestRef.current.get(name) !== requestToken) return;
        failed = true;
        await notifyRef.current(
          translateSaved("Не удалось сохранить настройку: {0}", { 0: getErrorMessage(error) })
        );
      } finally {
        finishSave(requestToken, failed);
      }
    });
  };
  return {
    form,
    saveStatus,
    saving: saveStatus === "saving",
    saved: saveStatus === "saved",
    updateField,
    saveField,
    save
  };
}
