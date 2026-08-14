import { useCallback, useEffect, useRef } from "react";

export default function useApplicationAudioMute(enabled) {
  const originalMuteStateRef = useRef(new Map());

  const muteApplicationAudio = useCallback(
    (root) => {
      if (!root) return;

      const audioElements = [
        ...(root instanceof HTMLAudioElement ? [root] : []),
        ...(root.querySelectorAll?.("audio") || [])
      ];

      for (const audio of audioElements) {
        if (audio.dataset.onlineRoomParticipant) continue;
        if (!originalMuteStateRef.current.has(audio)) {
          originalMuteStateRef.current.set(audio, audio.muted);
        }
        audio.muted = true;
      }
    },
    // Stryker disable next-line ArrayDeclaration: the callback closes over refs only.
    []
  );

  const restoreApplicationAudio = useCallback(
    () => {
      for (const [audio, wasMuted] of originalMuteStateRef.current) {
        if (audio.isConnected) audio.muted = wasMuted;
      }
      originalMuteStateRef.current.clear();
    },
    // Stryker disable next-line ArrayDeclaration: the callback closes over refs only.
    []
  );

  useEffect(() => {
    if (!enabled) return undefined;

    muteApplicationAudio(document);
    if (typeof MutationObserver === "undefined") {
      return restoreApplicationAudio;
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          muteApplicationAudio(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      restoreApplicationAudio();
    };
  }, [enabled, muteApplicationAudio, restoreApplicationAudio]);

  useEffect(
    () => restoreApplicationAudio,
    // Stryker disable next-line ArrayDeclaration: restoreApplicationAudio has stable identity.
    [restoreApplicationAudio]
  );

  return { muteApplicationAudio, restoreApplicationAudio };
}
