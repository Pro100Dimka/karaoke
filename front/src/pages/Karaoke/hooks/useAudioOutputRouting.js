import { useEffect } from "react";
import { api } from "../../../api/client";
import {
  findMatchingBrowserOutput,
  findPreferredOutputDevice
} from "../utils/audio-settings";

export default function useAudioOutputRouting(options) {
  const {
    audioDriver,
    audioSettings,
    browserMonitorRef,
    directOutputDeviceId,
    directOutputDevices,
    instrumentalRef,
    microphoneOpen,
    setDirectOutputDeviceId,
    updateMicrophone,
    videoRef,
    vocalsRef
  } = options;
  useEffect(() => {
    if (
      !microphoneOpen ||
      audioDriver !== "asio" ||
      audioSettings?.output_device_id != null
    )
      return;
    const preferred = findPreferredOutputDevice(directOutputDevices);
    if (preferred && String(directOutputDeviceId) !== String(preferred.index)) {
      setDirectOutputDeviceId(preferred.index);
      Promise.resolve(
        updateMicrophone({ output_device_id: preferred.index })
      ).catch(() => {});
    }
  }, [
    audioDriver,
    audioSettings?.output_device_id,
    directOutputDeviceId,
    directOutputDevices,
    microphoneOpen,
    setDirectOutputDeviceId,
    updateMicrophone
  ]);

  useEffect(() => {
    if (
      !microphoneOpen ||
      directOutputDeviceId == null ||
      directOutputDeviceId === "" ||
      typeof globalThis.navigator?.mediaDevices?.enumerateDevices !== "function"
    )
      return undefined;
    const selected = (directOutputDevices || []).find(
      (device) => String(device.index) === String(directOutputDeviceId)
    );
    if (!selected) return undefined;
    let active = true;
    globalThis.navigator.mediaDevices
      .enumerateDevices()
      .then((entries) => {
        if (!active) return;
        const output = findMatchingBrowserOutput(entries, selected);
        if (!output?.deviceId) return;
        [instrumentalRef.current, vocalsRef.current, videoRef.current].forEach(
          (media) => {
            if (typeof media?.setSinkId !== "function") return;
            Promise.resolve(media.setSinkId(output.deviceId)).catch(() => {});
          }
        );
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [
    directOutputDeviceId,
    directOutputDevices,
    instrumentalRef,
    microphoneOpen,
    videoRef,
    vocalsRef
  ]);

  useEffect(
    () => () => {
      const monitor = browserMonitorRef.current;
      monitor?.stream?.getTracks?.().forEach((track) => track.stop());
      if (monitor?.context && monitor.context.state !== "closed") {
        monitor.context.close().catch(() => {});
      }
      browserMonitorRef.current = null;
    },
    [browserMonitorRef]
  );

  useEffect(() => {
    const windowRef = globalThis.window;
    if (!windowRef?.addEventListener) return undefined;
    const releaseMonitorOnClose = () => {
      api.releaseDirectMonitoring().catch(() => {});
    };
    windowRef.addEventListener("pagehide", releaseMonitorOnClose);
    return () =>
      windowRef.removeEventListener("pagehide", releaseMonitorOnClose);
  }, []);
}
