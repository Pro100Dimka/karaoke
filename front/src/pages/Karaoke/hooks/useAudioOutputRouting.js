import { useEffect } from "react";
import { api } from "../../../api/client";
import { findDriverOutputDevice, findMatchingBrowserOutput } from "../utils/audio-settings";

const publishRoomOutputRoute = (deviceId) =>
  globalThis.dispatchEvent?.(
    new CustomEvent("audio-output-route-changed", { detail: { deviceId: deviceId || "" } })
  );

export default function useAudioOutputRouting(options) {
  const {
    audioDriver,
    audioSettings,
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
    if (audioDriver !== "asio" || String(configuredOutputId ?? "").trim()) return;
    const preferred = findDriverOutputDevice(directOutputDevices, asioDriverName);
    if (preferred && String(directOutputDeviceId) !== String(preferred.index)) {
      setDirectOutputDeviceId(preferred.index);
      Promise.resolve(updateMicrophone({ output_device_id: preferred.index })).catch(() => {});
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
    const enumerateDevices = globalThis.navigator.mediaDevices?.enumerateDevices;
    if (
      directOutputDeviceId == null ||
      directOutputDeviceId === "" ||
      typeof enumerateDevices !== "function"
    ) {
      publishRoomOutputRoute("");
      return undefined;
    }
    const selected = Array.from(directOutputDevices ?? []).find(
      (device) => String(device.index) === String(directOutputDeviceId)
    );
    if (!selected) {
      publishRoomOutputRoute("");
      return undefined;
    }
    let active = true;
    Promise.resolve(enumerateDevices.call(globalThis.navigator.mediaDevices))
      .then((entries) => {
        if (!active) return;
        const output = findMatchingBrowserOutput(entries, selected);
        // Stryker disable next-line ConditionalExpression: equivalent catch fallback.
        if (!output) {
          publishRoomOutputRoute("");
          return;
        }
        publishRoomOutputRoute(output.deviceId);
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
  }, [directOutputDeviceId, directOutputDevices, instrumentalRef, videoRef, vocalsRef]);

  useEffect(
    () => {
      let released = false;
      const releaseMonitorOnClose = () => {
        if (released) return;
        released = true;
        api.releaseDirectMonitoring().catch(() => {});
      };
      window.addEventListener("pagehide", releaseMonitorOnClose);
      return () => {
        window.removeEventListener("pagehide", releaseMonitorOnClose);
        releaseMonitorOnClose();
      };
    },
    // Stryker disable next-line ArrayDeclaration: browser/API globals are stable.
    []
  );
}
