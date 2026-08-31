import { useRef, useState } from "react";
import { api } from "../../api/client";
import { useAppDialog } from "../../contexts/AppDialog";
import { useRadio } from "../../contexts/radio";
import useAppSettings from "../../hooks/useAppSettings";
import { usePolling } from "../../hooks/usePolling";
import { translateSaved as tr } from "../../i18n/runtime";
import { POLLING_INTERVALS as POLL } from "../../runtime-config";
import { AUDIO_SETTINGS_CHANGED_EVENT } from "../../utils/audioSettingsEvents";
import { getErrorMessage } from "../../utils/errors";
import { applyTheme } from "../../utils/theme";
import { createInputDeviceOptions, createOutputDeviceOptions } from "../Karaoke/utils/devices";

const emit = (detail) => dispatchEvent(new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, { detail }));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const useOpenPoll = (open, fn, interval, fallback) =>
  usePolling(() => (open ? fn() : Promise.resolve(fallback)), open ? interval : 0, [open]);

function useQueue() {
  const queue = useRef(Promise.resolve());
  const latest = useRef(new Map());
  return (key, task) => {
    const token = Symbol(key);
    latest.current.set(key, token);
    return (queue.current = queue.current
      .catch(() => {})
      .then(() => task(() => latest.current.get(key) === token)));
  };
}

async function testSpeaker() {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio) return false;

  const context = new Audio({ latencyHint: "interactive" });
  const tone = context.createOscillator();
  const gain = context.createGain();

  gain.gain.setValueAtTime(0.12, context.currentTime);
  tone.frequency.setValueAtTime(523.25, context.currentTime);
  tone.connect(gain).connect(context.destination);
  tone.start();
  tone.stop(context.currentTime + 0.7);

  try {
    await wait(800);
  } finally {
    await context.close();
  }
  return true;
}

export const signalLevel = (signal) => {
  const db = Number(signal?.rms_db ?? signal?.rms_dbfs);
  return Number.isFinite(db) ? Math.min(100, Math.max(0, ((db + 60) / 60) * 100)) : 0;
};

function useAppActions() {
  const { settings: form, error, updateSettings } = useAppSettings();
  const queue = useQueue();
  return {
    form,
    error,
    change: (name, value) => name === "theme" && applyTheme(value),
    save: (name, value) =>
      queue(name, async (latest) => {
        const saved = await api.updateAppSettings({ [name]: value || null });
        if (latest()) updateSettings((state) => ({ ...state, [name]: saved[name] }));
      })
  };
}

function useAudio(open) {
  const { alert } = useAppDialog();
  const queue = useQueue();
  const settings = useOpenPoll(open, api.getAudioSettings, POLL.settings, null);
  const inputs = useOpenPoll(open, api.listAudioDevices, POLL.devices, []);
  const outputs = useOpenPoll(open, api.listAudioOutputDevices, POLL.devices, []);
  const signal = useOpenPoll(open, api.getSignalQuality, POLL.realtimeSignal, null);
  const monitorStatus = useOpenPoll(open, api.getDirectMonitorStatus, 750, null);
  const [local, setLocal] = useState({});
  const [wasapiMode, setWasapiMode] = useState("shared");
  const [autoBuffer, setAutoBuffer] = useState(false);
  const [busy, setBusy] = useState(false);
  const values = { ...settings.data, ...local };
  const needsAsio = open && Number(monitorStatus.data?.glitch_fallback_count) >= 2;
  const asio = useOpenPoll(needsAsio, api.listAsioDrivers, 0, null);
  const fail = (key, error) => alert(tr(key, { 0: getErrorMessage(error) }));
  const merge = (patch) => setLocal((state) => ({ ...state, ...patch }));
  const update = (name, value) => {
    const patch = { [name]: value };
    merge(patch);
    return queue(name, async (latest) => {
      try {
        const saved = await api.updateAudioSettings(patch);
        if (latest()) merge(saved);
        emit(saved);
        await settings.refresh();
      } catch (error) {
        await fail("settings.couldNotSaveAudioSettings", error);
      }
    });
  };
  const monitor = async (retry = false) => {
    setBusy(true);
    try {
      const enabled = !!values.monitoring_enabled && !retry;
      const saved = await (enabled
        ? api.stopDirectMonitoring()
        : api.startDirectMonitoring({ disabledEffects: true, wasapiMode, autoBuffer }));

      merge({ monitoring_enabled: !enabled });
      emit(saved);
      await Promise.all([monitorStatus.refresh(), settings.refresh()]);
    } catch (error) {
      await fail("settings.couldNotChangeMonitoring", error);
    } finally {
      setBusy(false);
    }
  };
  const speaker = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await testSpeaker();
    } catch (error) {
      await fail("settings.failedToCheckSpeakers", error);
    } finally {
      setBusy(false);
    }
  };
  return {
    values,
    busy,
    update,
    monitor,
    speaker,
    wasapiMode,
    setWasapiMode,
    autoBuffer,
    setAutoBuffer,
    monitorStatus: monitorStatus.data,
    monitorStatusError: monitorStatus.error,
    suggestAsio: needsAsio && Array.isArray(asio.data) && !asio.data.length,
    level: values.monitoring_enabled ? signalLevel(signal.data) : 0,
    options: {
      inputs: createInputDeviceOptions(inputs.data, values.input_device_id),
      outputs: createOutputDeviceOptions(
        outputs.data,
        values.output_device_id,
        values.audio_driver,
        tr("karaoke.systemDevice")
      )
    }
  };
}

export default function useSettings(open) {
  return { app: useAppActions(), audio: useAudio(open), radio: useRadio() };
}
