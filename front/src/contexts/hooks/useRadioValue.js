import { useMemo } from "react";
import { RADIO_STATIONS } from "../radio-config";

export default function useRadioValue({
  bassRef,
  error,
  isLoading,
  isPlaying,
  setRecordingActive,
  setStation,
  setVolume,
  spectrumRef,
  station,
  stationId,
  toggle,
  turnOff,
  turnOn,
  volume
}) {
  return useMemo(
    () => ({
      error,
      isLoading,
      isPlaying,
      station,
      stationId,
      stations: RADIO_STATIONS,
      volume,
      setRecordingActive,
      setStation,
      setVolume,
      toggle,
      turnOff,
      turnOn,
      getBassLevel: () => bassRef.current,
      getSpectrumLevels: () => spectrumRef.current
    }),
    [
      bassRef,
      error,
      isLoading,
      isPlaying,
      setRecordingActive,
      setStation,
      setVolume,
      spectrumRef,
      station,
      stationId,
      toggle,
      turnOff,
      turnOn,
      volume
    ]
  );
}
