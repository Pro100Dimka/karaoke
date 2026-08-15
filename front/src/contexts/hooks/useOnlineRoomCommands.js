import { useCallback } from "react";
import { openKaraokeInRoom } from "../onlineRoomActions";

export default function useOnlineRoomCommands({ clientRef, connectionTokenRef, roomRef }) {
  const syncUi = useCallback(
    (state) => {
      if (roomRef.current?.host) clientRef.current?.send("ui", { state });
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
    (songId) => {
      const client = clientRef.current;
      const connectionToken = connectionTokenRef.current;
      return openKaraokeInRoom({
        songId,
        room: roomRef.current,
        client,
        isCurrentConnection: () => connectionToken === connectionTokenRef.current
      });
    },
    [clientRef, connectionTokenRef, roomRef]
  );

  return { openKaraoke, syncCommand, syncUi };
}
