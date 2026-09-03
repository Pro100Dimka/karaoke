import { useEffect } from "react";
import { findDriverOutputDevice, findMatchingBrowserOutput } from "../utils/audio-settings";

const publishRoute = (deviceId = "") =>
  globalThis.dispatchEvent?.(
    new CustomEvent("audio-output-route-changed", { detail: { deviceId } })
  );

export default function useAudioOutputRouting({
  audioDriver,
  audioSettings,
  directOutputDeviceId,
  directOutputDevices,
  instrumentalRef,
  setDirectOutputDeviceId,
  updateMicrophone,
  videoRef,
  vocalsRef
}) {
  useEffect(() => {
    if (audioDriver !== "asio" || String(audioSettings?.output_device_id ?? "").trim()) return;

    const device = findDriverOutputDevice(directOutputDevices, audioSettings?.asio_driver_name);
    if (!device || String(directOutputDeviceId) === String(device.index)) return;

    setDirectOutputDeviceId(device.index);
    Promise.resolve(updateMicrophone({ output_device_id: device.index })).catch(() => {});
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
    let active = true;
    const media = () => [instrumentalRef.current, vocalsRef.current, videoRef.current].filter(Boolean);
    const route = (deviceId = "") => {
      if (!active) return;
      publishRoute(deviceId);
      media().forEach((element) => {
        if (typeof element.setSinkId === "function") {
          Promise.resolve(element.setSinkId(deviceId)).catch(() => {});
        }
      });
    };

    if (directOutputDeviceId == null || directOutputDeviceId === "") {
      route();
      return () => {
        active = false;
      };
    }

    const selected = (Array.isArray(directOutputDevices) ? directOutputDevices : []).find(
      (device) => String(device?.index) === String(directOutputDeviceId)
    );
    const devices = globalThis.navigator?.mediaDevices;
    if (!selected || typeof devices?.enumerateDevices !== "function") {
      route();
      return () => {
        active = false;
      };
    }

    devices
      .enumerateDevices()
      .then((entries) => route(findMatchingBrowserOutput(entries, selected)?.deviceId || ""))
      .catch(() => route());

    return () => {
      active = false;
    };
  }, [directOutputDeviceId, directOutputDevices, instrumentalRef, videoRef, vocalsRef]);
}
