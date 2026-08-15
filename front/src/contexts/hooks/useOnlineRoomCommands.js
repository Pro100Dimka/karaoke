import { useCallback } from "react";
import { api } from "../../api/client";
import { openKaraokeInRoom } from "../onlineRoomActions";

export default function useOnlineRoomCommands({
  clientRef,
  connectionTokenRef,
  pendingSongCommandRef,
  roomRef,
  setTransferStatus
}) {
  const syncUi = useCallback((state) => { clientRef.current?.send("ui", { state }); }, [clientRef]);

  const syncCommand = useCallback((state) => {
    clientRef.current?.send("sync", { state });
  }, [clientRef]);

  const openKaraoke = useCallback(
    (songId) => {
      const client = clientRef.current;
      const connectionToken = connectionTokenRef.current;
      return openKaraokeInRoom({
        songId,
        room: roomRef.current,
        client,
        roomApi: api,
        isCurrentConnection: () =>
          connectionToken === connectionTokenRef.current,
        pendingSongCommandRef,
        setTransferStatus
      });
    },
    [clientRef, connectionTokenRef, pendingSongCommandRef, roomRef, setTransferStatus]
  );

  return { openKaraoke, syncCommand, syncUi };
}
