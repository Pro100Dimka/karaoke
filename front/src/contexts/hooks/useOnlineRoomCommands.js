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
      // Guests are restricted to broadcasting their own library/effects (the
      // worker enforces this too); everything else stays host-only.
      if (roomRef.current?.host || state?.participantEffects || Array.isArray(state?.songs))
        clientRef.current?.send("ui", { state });
    },
    [clientRef, roomRef]
  );

  const syncCommand = useCallback(
    (state) => {
      if (roomRef.current?.host) clientRef.current?.send("sync", { state });
    },
    [clientRef, roomRef]
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

  return { openKaraoke, syncCommand, syncUi };
}
