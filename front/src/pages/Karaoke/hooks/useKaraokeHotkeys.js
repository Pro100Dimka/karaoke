import { useEffect } from "react";
import useLatestRef from "../../../hooks/useLatestRef";
import { getKaraokeHotkeyAction } from "../utils/hotkeys";

const ACTIONS = {
  "toggle-playback": ({ onTogglePlay }) => onTogglePlay?.(),
  "seek-backward": ({ currentTime, onSeek }) =>
    onSeek?.(Math.max(0, (Number(currentTime) || 0) - 5)),
  "seek-forward": ({ currentTime, duration, onSeek }) =>
    onSeek?.(
      Math.min(Math.max(0, Number(duration) || 0), (Number(currentTime) || 0) + 5)
    ),
  stop: ({ onStop }) => onStop?.()
};

export function dispatchKaraokeHotkey(action, context) {
  return ACTIONS[action]?.(context);
}

export default function useKaraokeHotkeys({ scopeRef, ...context }) {
  const contextRef = useLatestRef(context);

  useEffect(() => {
    const onKeyDown = (event) => {
      const action = getKaraokeHotkeyAction(event, scopeRef.current);
      if (!action) return;
      if (action !== "stop") event.preventDefault();
      dispatchKaraokeHotkey(action, contextRef.current);
    };

    globalThis.addEventListener?.("keydown", onKeyDown);
    return () => globalThis.removeEventListener?.("keydown", onKeyDown);
  }, [contextRef, scopeRef]);
}
