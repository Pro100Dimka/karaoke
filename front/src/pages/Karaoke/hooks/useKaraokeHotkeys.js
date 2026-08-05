import { useEffect } from "react";
import useLatestRef from "../../../hooks/useLatestRef";
import { getKaraokeHotkeyAction } from "../utils/hotkeys";

export default function useKaraokeHotkeys({
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
      const action = getKaraokeHotkeyAction(event);
      if (!action) return;

      if (action !== "stop") event.preventDefault();

      if (action === "toggle-playback") {
        togglePlayRef.current?.();
      } else if (action === "seek-backward") {
        seekRef.current?.(Math.max(0, currentTimeRef.current - 5));
      } else if (action === "seek-forward") {
        seekRef.current?.(
          Math.min(durationRef.current, currentTimeRef.current + 5)
        );
      } else if (action === "stop") {
        stopRef.current?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentTimeRef, durationRef, seekRef, stopRef, togglePlayRef]);
}
