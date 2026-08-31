import { useCallback } from "react";
import { openKaraokeInRoom } from "../onlineRoomActions";

export default function useOnlineRoomCommands({
  api,
  clientRef,
  connectionTokenRef,
  hostSongCommandRef,
  onTransferStatus,
  participantsRef,
  roomRef,
  voiceRef
}) {
  const syncUi = useCallback(
    (state) => {
      if (roomRef.current) return clientRef.current?.send("ui", { state });
      return false;
    },
    [clientRef, roomRef]
  );

  const syncCommand = useCallback(
    (state) => {
      // Playback is a shared karaoke console: every connected participant is
      // allowed to press play/pause/seek. The worker validates this narrow
      // karaoke-player shape; all other authoritative commands remain host-only.
      if (roomRef.current?.host || state?.type === "karaoke-player")
        return clientRef.current?.send("sync", { state });
      return false;
    },
    [clientRef, roomRef]
  );

  const roomClockNow = useCallback(
    () => clientRef.current?.serverNow?.() ?? Date.now(),
    [clientRef]
  );

  const openKaraoke = useCallback(
    (songId, options = {}) => {
      const client = clientRef.current;
      const connectionToken = connectionTokenRef.current;
      return openKaraokeInRoom({
        songId,
        ownerId: options.ownerId,
        revision: options.revision,
        room: roomRef.current,
        client,
        roomApi: api,
        hostSongCommandRef,
        onTransferStatus,
        participantsRef,
        voice: voiceRef.current,
        isCurrentConnection: () => connectionToken === connectionTokenRef.current
      });
    },
    [
      api,
      clientRef,
      connectionTokenRef,
      hostSongCommandRef,
      onTransferStatus,
      participantsRef,
      roomRef,
      voiceRef
    ]
  );

  return { openKaraoke, roomClockNow, syncCommand, syncUi };
}
