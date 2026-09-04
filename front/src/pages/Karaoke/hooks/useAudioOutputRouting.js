import { useEffect } from "react";
import { findDriverOutputDevice, findMatchingBrowserOutput } from "../utils/audio-settings";

const safe = (task) => Promise.resolve().then(task).catch(() => {});
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

    safe(async () => {
      const updated = await updateMicrophone({ output_device_id: device.index });
      if (updated) setDirectOutputDeviceId(updated.output_device_id ?? device.index);
    });
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
    const route = (deviceId = "") => {
      if (!active) return;
      publishRoute(deviceId);
      for (const media of [instrumentalRef.current, vocalsRef.current, videoRef.current]) {
        if (typeof media?.setSinkId === "function") safe(() => media.setSinkId(deviceId));
      }
    };

    const selected = (Array.isArray(directOutputDevices) ? directOutputDevices : []).find(
      ({ index }) => String(index) === String(directOutputDeviceId)
    );
    const devices = globalThis.navigator?.mediaDevices;

    if (directOutputDeviceId == null || directOutputDeviceId === "" || !selected) {
      route();
    } else if (typeof devices?.enumerateDevices === "function") {
      devices
        .enumerateDevices()
        .then((entries) => route(findMatchingBrowserOutput(entries, selected)?.deviceId || ""))
        .catch(() => route());
    } else {
      route();
    }

    return () => {
      active = false;
    };
  }, [directOutputDeviceId, directOutputDevices, instrumentalRef, videoRef, vocalsRef]);
}
