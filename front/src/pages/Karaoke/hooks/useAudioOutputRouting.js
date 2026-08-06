import { useEffect } from "react";
import { api } from "../../../api/client";
import {
  findMatchingBrowserOutput,
  findPreferredOutputDevice
} from "../utils/audio-settings";

export default function useAudioOutputRouting(options) {
  const {
    audioDriver, audioSettings, browserMonitorRef,
    directOutputDeviceId, directOutputDevices, instrumentalRef,
    microphoneOpen, setDirectOutputDeviceId, updateMicrophone,
    videoRef, vocalsRef
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
      updateMicrophone({ output_device_id: preferred.index });
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
      (directOutputDeviceId == null || directOutputDeviceId === "") ||
      !navigator.mediaDevices?.enumerateDevices
    )
      return;
    const selected = (directOutputDevices || []).find(
      (device) => String(device.index) === String(directOutputDeviceId)
    );
    if (!selected) return;
    let active = true;
    navigator.mediaDevices
      .enumerateDevices()
      .then((entries) => {
        if (!active) return;
        const output = findMatchingBrowserOutput(entries, selected);
        if (!output?.deviceId) return;
        [instrumentalRef.current, vocalsRef.current, videoRef.current].forEach(
          (media) => media?.setSinkId?.(output.deviceId).catch(() => {})
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
      monitor?.stream.getTracks().forEach((track) => track.stop());
      monitor?.context.close().catch(() => {});
      browserMonitorRef.current = null;
    },
    [browserMonitorRef]
  );

  useEffect(() => {
    const releaseMonitorOnClose = () => {
      api.releaseDirectMonitoring();
    };
    window.addEventListener("pagehide", releaseMonitorOnClose);
    return () => window.removeEventListener("pagehide", releaseMonitorOnClose);
  }, []);
}
