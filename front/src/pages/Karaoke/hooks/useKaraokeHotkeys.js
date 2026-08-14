import { useEffect } from "react";
import useLatestRef from "../../../hooks/useLatestRef";
import { getKaraokeHotkeyAction } from "../utils/hotkeys";

export function dispatchKaraokeHotkey(
  action,
  { currentTime, duration, onTogglePlay, onSeek, onStop }
) {
  if (action === "toggle-playback") {
    onTogglePlay?.();
  } else if (action === "seek-backward") {
    onSeek?.(Math.max(0, currentTime - 5));
  } else if (action === "seek-forward") {
    onSeek?.(Math.min(duration, currentTime + 5));
  } else {
    onStop?.();
  }
}

export default function useKaraokeHotkeys({
  scopeRef,
  currentTime,
  duration,
  onTogglePlay,
  onSeek,
  onStop
}) {
  const currentTimeRef = useLatestRef(currentTime);
  const durationRef = useLatestRef(duration);
  const togglePlayRef = useLatestRef(onTogglePlay);
  const seekRef = useLatestRef(onSeek);
  const stopRef = useLatestRef(onStop);

  useEffect(() => {
    const onKeyDown = (event) => {
      const action = getKaraokeHotkeyAction(event, scopeRef.current);
      if (!action) return;

      if (action !== "stop") event.preventDefault();

      dispatchKaraokeHotkey(action, {
        currentTime: currentTimeRef.current,
        duration: durationRef.current,
        onTogglePlay: togglePlayRef.current,
        onSeek: seekRef.current,
        onStop: stopRef.current
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentTimeRef, durationRef, scopeRef, seekRef, stopRef, togglePlayRef]);
}
