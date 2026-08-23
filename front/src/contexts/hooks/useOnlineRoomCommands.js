import { useCallback, useEffect, useRef } from "react";
import { openKaraokeInRoom } from "../onlineRoomActions";

const UI_SYNC_DELAY_MS = 200;

export default function useOnlineRoomCommands({
  api,
  clientRef,
  connectionTokenRef,
  hostSongCommandRef,
  participantsRef,
  roomRef,
  voiceRef
}) {
  const pendingUiRef = useRef(null);
  const uiTimerRef = useRef(null);

  const flushUi = useCallback(() => {
    if (uiTimerRef.current != null) {
      clearTimeout(uiTimerRef.current);
      uiTimerRef.current = null;
    }
    const state = pendingUiRef.current;
    pendingUiRef.current = null;
    if (state && roomRef.current) clientRef.current?.send("ui", { state });
  }, [clientRef, roomRef]);

  const syncUi = useCallback(
    (state) => {
      if (!roomRef.current || !state || typeof state !== "object" || Array.isArray(state)) return;
      pendingUiRef.current = { ...(pendingUiRef.current || {}), ...state };
      if (uiTimerRef.current == null)
        uiTimerRef.current = setTimeout(flushUi, UI_SYNC_DELAY_MS);
    },
    [flushUi, roomRef]
  );

  useEffect(
    () => () => {
      if (uiTimerRef.current != null) clearTimeout(uiTimerRef.current);
      uiTimerRef.current = null;
      pendingUiRef.current = null;
    },
    []
  );

  const syncCommand = useCallback(
    (state) => {
      if (roomRef.current) clientRef.current?.send("sync", { state });
    },
    [clientRef, roomRef]
  );

  const openKaraoke = useCallback(
    (songId) => {
      const client = clientRef.current;
      const connectionToken = connectionTokenRef.current;
      return openKaraokeInRoom({
        songId,
        room: roomRef.current,
        client,
        roomApi: api,
        hostSongCommandRef,
        participantsRef,
        voice: voiceRef.current,
        isCurrentConnection: () => connectionToken === connectionTokenRef.current
      });
    },
    [api, clientRef, connectionTokenRef, hostSongCommandRef, participantsRef, roomRef, voiceRef]
  );

  return { openKaraoke, syncCommand, syncUi };
}
