import { useEffect } from "react";
import { api } from "../../../api/client";
import {
  findDriverOutputDevice,
  findMatchingBrowserOutput
} from "../utils/audio-settings";

export default function useAudioOutputRouting(options) {
  const {
    audioDriver,
    audioSettings,
    browserMonitorRef,
    directOutputDeviceId,
    directOutputDevices,
    instrumentalRef,
    setDirectOutputDeviceId,
    updateMicrophone,
    videoRef,
    vocalsRef
  } = options;
  useEffect(() => {
    if (audioDriver !== "asio" || audioSettings?.output_device_id != null)
      return;
    const preferred = findDriverOutputDevice(
      directOutputDevices,
      audioSettings?.asio_driver_name
    );
    if (preferred && String(directOutputDeviceId) !== String(preferred.index)) {
      setDirectOutputDeviceId(preferred.index);
      Promise.resolve(
        updateMicrophone({ output_device_id: preferred.index })
      ).catch(() => {});
    }
  }, [
    audioDriver,
    audioSettings?.asio_driver_name,
    audioSettings?.output_device_id,
    directOutputDeviceId,
    directOutputDevices,
    setDirectOutputDeviceId,
    updateMicrophone
  ]);

  useEffect(() => {
    if (
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
    const releaseMonitorOnClose = () => {
      api.releaseDirectMonitoring().catch(() => {});
    };
    window.addEventListener("pagehide", releaseMonitorOnClose);
    return () => window.removeEventListener("pagehide", releaseMonitorOnClose);
  }, []);
}
