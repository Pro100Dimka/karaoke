import { useEffect, useState } from "react";
import {
  loadKaraokePreferences,
  saveKaraokePreferences
} from "../utils/preferences";

export default function useKaraokePreferences() {
  const [preferences] = useState(loadKaraokePreferences);
  const [musicVolume, setMusicVolume] = useState(
    () => preferences.musicVolume ?? 1
  );
  const [vocalVolume, setVocalVolume] = useState(
    () => preferences.vocalVolume ?? 1
  );
  const [melodyVolume, setMelodyVolume] = useState(
    () => preferences.melodyVolume ?? 0
  );
  const [speed, setSpeed] = useState(() => preferences.speed ?? 1);
  const [keyShift, setKeyShift] = useState(() => preferences.keyShift ?? 0);
  const [showLyrics, setShowLyrics] = useState(
    () => preferences.showLyrics ?? true
  );
  const [showNotes, setShowNotes] = useState(
    () => preferences.showNotes ?? true
  );
  const [autoHideConsole, setAutoHideConsole] = useState(
    () => preferences.autoHideConsole ?? true
  );
  const [effectPreset, setEffectPreset] = useState(
    () => preferences.effectPreset ?? "studio"
  );

  useEffect(() => {
    saveKaraokePreferences({
      musicVolume,
      vocalVolume,
      melodyVolume,
      speed,
      keyShift,
      showLyrics,
      showNotes,
      autoHideConsole,
      effectPreset
    });
  }, [
    musicVolume,
    vocalVolume,
    melodyVolume,
    speed,
    keyShift,
    showLyrics,
    showNotes,
    autoHideConsole,
    effectPreset
  ]);

  return {
    musicVolume,
    setMusicVolume,
    vocalVolume,
    setVocalVolume,
    melodyVolume,
    setMelodyVolume,
    speed,
    setSpeed,
    keyShift,
    setKeyShift,
    showLyrics,
    setShowLyrics,
    showNotes,
    setShowNotes,
    autoHideConsole,
    setAutoHideConsole,
    effectPreset,
    setEffectPreset
  };
}
