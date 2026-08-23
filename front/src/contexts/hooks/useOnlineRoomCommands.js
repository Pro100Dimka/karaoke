import { useCallback } from "react";
import { openKaraokeInRoom } from "../onlineRoomActions";

export default function useOnlineRoomCommands({
  api,
  clientRef,
  connectionTokenRef,
  hostSongCommandRef,
  participantsRef,
  roomRef,
  voiceRef
}) {
  const syncUi = useCallback(
    (state) => {
      if (roomRef.current) clientRef.current?.send("ui", { state });
    },
    [clientRef, roomRef]
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
