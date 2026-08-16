import { useCallback } from "react";
import { openKaraokeInRoom } from "../onlineRoomActions";

export default function useOnlineRoomCommands({ api, clientRef, connectionTokenRef, hostSongCommandRef, roomRef, voiceRef }) {
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
      roomApi: api,
      hostSongCommandRef,
      voice: voiceRef.current,
      isCurrentConnection: () => connectionToken === connectionTokenRef.current
    });
  }, [api, clientRef, connectionTokenRef, hostSongCommandRef, roomRef, voiceRef]);

  return { openKaraoke, syncCommand, syncUi };
}
