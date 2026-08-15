import { useEffect } from "react";
import { api } from "../../../api/client";
import {
  findDriverOutputDevice,
  findMatchingBrowserOutput
} from "../utils/audio-settings";
import { closeAudioContextQuietly } from "../../../utils/audio-context";

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
  const asioDriverName = audioSettings?.asio_driver_name;
  const configuredOutputId = audioSettings?.output_device_id;
  useEffect(() => {
    if (audioDriver !== "asio" || configuredOutputId != null) return;
    const preferred = findDriverOutputDevice(
      directOutputDevices,
      asioDriverName
    );
    if (preferred && String(directOutputDeviceId) !== String(preferred.index)) {
      setDirectOutputDeviceId(preferred.index);
      Promise.resolve(
        updateMicrophone({ output_device_id: preferred.index })
      ).catch(() => {});
    }
  }, [
    audioDriver,
    asioDriverName,
    configuredOutputId,
    directOutputDeviceId,
    directOutputDevices,
    setDirectOutputDeviceId,
    updateMicrophone
  ]);

  useEffect(() => {
    const enumerateDevices =
      globalThis.navigator.mediaDevices?.enumerateDevices;
    if (
      directOutputDeviceId == null ||
      directOutputDeviceId === "" ||
      typeof enumerateDevices !== "function"
    )
      return undefined;
    const selected = Array.from(directOutputDevices ?? Array.of()).find(
      (device) => String(device.index) === String(directOutputDeviceId)
    );
    if (!selected) return undefined;
    let active = true;
    Promise.resolve(enumerateDevices.call(globalThis.navigator.mediaDevices))
      .then((entries) => {
        if (!active) return;
        const output = findMatchingBrowserOutput(entries, selected);
        // Stryker disable next-line ConditionalExpression: equivalent catch fallback.
        if (!output) return;
        [instrumentalRef.current, vocalsRef.current, videoRef.current]
          .filter(Boolean)
          .forEach((media) => {
            if (typeof media.setSinkId !== "function") return;
            Promise.resolve(media.setSinkId(output.deviceId)).catch(() => {});
          });
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
        closeAudioContextQuietly(monitor.context);
      }
      browserMonitorRef.current = null;
    },
    [browserMonitorRef]
  );

  useEffect(
    () => {
      const releaseMonitorOnClose = () => {
        api.releaseDirectMonitoring().catch(() => {});
      };
      window.addEventListener("pagehide", releaseMonitorOnClose);
      return () =>
        window.removeEventListener("pagehide", releaseMonitorOnClose);
    },
    // Stryker disable next-line ArrayDeclaration: browser/API globals are stable.
    []
  );
}
