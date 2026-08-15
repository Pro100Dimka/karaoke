import { useCallback } from "react";
import { openKaraokeInRoom } from "../onlineRoomActions";

export default function useOnlineRoomCommands({ clientRef, connectionTokenRef, hostSongCommandRef, roomRef }) {
  const syncUi = useCallback((state) => {
    if (roomRef.current?.host) clientRef.current?.send("ui", { state });
  }, [clientRef, roomRef]);

  const syncCommand = useCallback((state) => {
    if (roomRef.current?.host) clientRef.current?.send("sync", { state });
  }, [clientRef, roomRef]);

  const openKaraoke = useCallback((songId) => {
    const client = clientRef.current;
    const connectionToken = connectionTokenRef.current;
    return openKaraokeInRoom({
      songId,
      room: roomRef.current,
      client,
      hostSongCommandRef,
      isCurrentConnection: () => connectionToken === connectionTokenRef.current
    });
  }, [clientRef, connectionTokenRef, hostSongCommandRef, roomRef]);

  return { openKaraoke, syncCommand, syncUi };
}
