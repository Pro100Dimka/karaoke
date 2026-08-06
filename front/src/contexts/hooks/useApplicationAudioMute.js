import { useCallback, useEffect, useRef } from "react";

function isAudioElement(node) {
  return (
    typeof HTMLAudioElement !== "undefined" && node instanceof HTMLAudioElement
  );
}

function isElement(node) {
  return typeof Element !== "undefined" && node instanceof Element;
}

export default function useApplicationAudioMute(enabled) {
  const originalMuteStateRef = useRef(new Map());

  const muteApplicationAudio = useCallback((root) => {
    if (!root) return;

    const audioElements = [
      ...(isAudioElement(root) ? [root] : []),
      ...(root.querySelectorAll?.("audio") || [])
    ];

    for (const audio of audioElements) {
      if (audio.dataset.onlineRoomParticipant) continue;
      if (!originalMuteStateRef.current.has(audio)) {
        originalMuteStateRef.current.set(audio, audio.muted);
      }
      audio.muted = true;
    }
  }, []);

  const restoreApplicationAudio = useCallback(() => {
    for (const [audio, wasMuted] of originalMuteStateRef.current) {
      if (audio.isConnected) audio.muted = wasMuted;
    }
    originalMuteStateRef.current.clear();
  }, []);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return undefined;

    muteApplicationAudio(document);
    if (typeof MutationObserver === "undefined") return undefined;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (isElement(node)) muteApplicationAudio(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [enabled, muteApplicationAudio]);

  useEffect(() => restoreApplicationAudio, [restoreApplicationAudio]);

  return { muteApplicationAudio, restoreApplicationAudio };
}
