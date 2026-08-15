import { useEffect } from "react";
import useLatestRef from "../../../hooks/useLatestRef";
import { getKaraokeHotkeyAction } from "../utils/hotkeys";

const HOTKEY_DISPATCHERS = {
  "toggle-playback": ({ onTogglePlay }) => onTogglePlay?.(),
  "seek-backward": ({ currentTime, onSeek }) =>
    onSeek?.(Math.max(0, currentTime - 5)),
  "seek-forward": ({ currentTime, duration, onSeek }) =>
    onSeek?.(Math.min(duration, currentTime + 5)),
  stop: ({ onStop }) => onStop?.()
};

export function dispatchKaraokeHotkey(action, context) {
  const dispatch = Object.hasOwn(HOTKEY_DISPATCHERS, action)
    ? HOTKEY_DISPATCHERS[action]
    : HOTKEY_DISPATCHERS.stop;
  dispatch(context);
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
