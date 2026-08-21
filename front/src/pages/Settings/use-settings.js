import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useAppDialog } from "../../contexts/AppDialog";
import { useRadio } from "../../contexts/radio";
import useAppSettings from "../../hooks/useAppSettings";
import { usePolling } from "../../hooks/usePolling";
import { translateSaved as tr } from "../../i18n/runtime";
import { POLLING_INTERVALS } from "../../runtime-config";
import { getErrorMessage } from "../../utils/errors";
import { applyTheme } from "../../utils/theme";
import { createIndexedDeviceOptions } from "../Karaoke/utils/devices";

export const signalLevel = (signal) => {
  const db = Number(signal?.rms_db ?? signal?.rms_dbfs);
  return Number.isFinite(db) ? Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) : 0;
};

const useConditionalPolling = (open, fetcher, interval, fallback) =>
  usePolling(() => (open ? fetcher() : Promise.resolve(fallback)), open ? interval : 0, [open]);

function useAppForm() {
  const { alert } = useAppDialog();
  const { updateSettings } = useAppSettings();
  const [form, setForm] = useState(null);
  const writes = useRef(new Map());
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    api
      .getAppSettings()
      .then((value) => active && setForm(value))
      .catch((error) => {
        if (active) alert(tr("Не удалось загрузить настройки: {0}", { 0: getErrorMessage(error) }));
      });
    return () => {
      active = false;
    };
  }, [alert]);

  const change = useCallback((name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    if (name === "theme") applyTheme(value);
  }, []);

  const save = useCallback(
    (name, value) => {
      const token = Symbol(name);
      writes.current.set(name, token);
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          try {
            const saved = await api.updateAppSettings({ [name]: value === "" ? null : value });
            if (writes.current.get(name) !== token) return;
            setForm((current) => ({ ...current, ...saved }));
            updateSettings((current) => ({ ...current, ...saved }));
          } catch (error) {
            await alert(tr("Не удалось сохранить настройку: {0}", { 0: getErrorMessage(error) }));
          }
        });
      return queue.current;
    },
    [alert, updateSettings]
  );

  return { form, change, save };
}

function useAudio(open) {
  const { alert } = useAppDialog();
  const settings = useConditionalPolling(
    open,
    api.getAudioSettings,
    POLLING_INTERVALS.settings,
    null
  );
  const inputs = useConditionalPolling(open, api.listAudioDevices, POLLING_INTERVALS.devices, []);
  const outputs = useConditionalPolling(
    open,
    api.listAudioOutputDevices,
    POLLING_INTERVALS.devices,
    []
  );
  const signal = useConditionalPolling(
    open,
    api.getSignalQuality,
    POLLING_INTERVALS.realtimeSignal,
    null
  );
  const [local, setLocal] = useState({});
  const [busy, setBusy] = useState(false);
  const queue = useRef(Promise.resolve());
  const writes = useRef(new Map());
  const values = { ...(settings.data ?? {}), ...local };

  const update = (name, value) => {
    const patch = { [name]: value };
    const token = Symbol(name);
    writes.current.set(name, token);
    setLocal((current) => ({ ...current, ...patch }));
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          const saved = await api.updateAudioSettings(patch);
          if (writes.current.get(name) === token) {
            setLocal((current) => ({ ...current, ...saved }));
          }
          await settings.refresh();
        } catch (error) {
          await alert(
            tr("Не удалось сохранить аудионастройки: {0}", { 0: getErrorMessage(error) })
          );
        }
      });
    return queue.current;
  };

  const monitor = async () => {
    setBusy(true);
    try {
      const enabled = Boolean(values.monitoring_enabled);
      await (enabled
        ? api.stopDirectMonitoring()
        : api.startDirectMonitoring({ disabledEffects: true }));
      setLocal((current) => ({ ...current, monitoring_enabled: !enabled }));
      await settings.refresh();
    } catch (error) {
      await alert(tr("Не удалось изменить прослушивание: {0}", { 0: getErrorMessage(error) }));
    } finally {
      setBusy(false);
    }
  };

  const speaker = async () => {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext || busy) return;
    setBusy(true);
    let context;
    try {
      context = new AudioContext({ latencyHint: "interactive" });
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.12, context.currentTime);
      oscillator.frequency.setValueAtTime(523.25, context.currentTime);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.7);
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (error) {
      await alert(tr("Не удалось проверить динамики: {0}", { 0: getErrorMessage(error) }));
    } finally {
      await context?.close?.();
      setBusy(false);
    }
  };

  return {
    values,
    options: {
      inputs: createIndexedDeviceOptions(inputs.data),
      outputs: createIndexedDeviceOptions(outputs.data, tr("Системное устройство"))
    },
    level: values.monitoring_enabled ? signalLevel(signal.data) : 0,
    busy,
    update,
    monitor,
    speaker
  };
}

export default function useSettings(open) {
  const app = useAppForm();
  const audio = useAudio(open);
  const radio = useRadio();
  return { app, audio, radio };
}
