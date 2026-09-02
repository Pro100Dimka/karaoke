import { useEffect, useState } from "react";
import { api } from "../api/client";
import { normalizeAudioRuntimeSettings } from "../pages/Karaoke/utils/audio-settings";
import { acquireMicrophone } from "../services/microphoneCapture";
import { AUDIO_SETTINGS_CHANGED_EVENT } from "../utils/audioSettingsEvents";

// The "Windows Driver Low Latency" audio driver monitors self-listening
// entirely inside a Web Audio graph on the browser's own microphone capture
// (see services/microphoneCapture.js's setMonitoring), instead of the native
// WASAPI worker used by the plain "Windows Driver" option. That keeps it
// from ever competing with the online room's separate getUserMedia capture
// for exclusive device access -- the tradeoff a friend without a dedicated
// audio interface ran into with the native monitor's WASAPI shared-mode
// latency. Mounted once at the app root (like KeyboardLighting) so the
// toggle in Settings keeps working while singing/browsing, not just while
// the Settings dialog itself is open.
export default function LowLatencyMicMonitor() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const sync = (settings) => {
      if (cancelled) return;
      const normalized = normalizeAudioRuntimeSettings(settings);
      setActive(normalized.audioDriver === "auto-low-latency" && normalized.monitoringEnabled);
    };
    api.getAudioSettings().then(sync).catch(() => {});
    const onChange = (event) => sync(event.detail);
    globalThis.addEventListener(AUDIO_SETTINGS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      globalThis.removeEventListener(AUDIO_SETTINGS_CHANGED_EVENT, onChange);
    };
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let lease = null;
    acquireMicrophone("", { disabledEffects: false })
      .then((acquired) => {
        if (cancelled) {
          acquired.release();
          return;
        }
        lease = acquired;
        lease.setMonitoring(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      lease?.setMonitoring(false);
      lease?.release();
    };
  }, [active]);

  return null;
}
