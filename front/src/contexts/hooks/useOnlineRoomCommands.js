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
      // allowed to control playback or return everyone to the library.
      // Starting a new song still goes through the host's preparation flow.
      if (
        roomRef.current &&
        (roomRef.current.host || ["karaoke-player", "open-library"].includes(state?.type))
      )
        return clientRef.current?.send("sync", { state: state?.type === "karaoke-player"
          ? { ...state, positionAt: clientRef.current?.serverNow?.() ?? Date.now() } : state });
      return false;
    },
    [clientRef, roomRef]
  );

  const roomClockNow = useCallback(
    () => clientRef.current?.serverNow?.() ?? Date.now(),
    [clientRef]
  );

  const getLocalVoiceStream = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice) return null;
    await voice.start();
    return voiceRef.current === voice ? voice.getMeterStream() : null;
  }, [voiceRef]);

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

  return { openKaraoke, roomClockNow, syncCommand, syncUi, getLocalVoiceStream };
}
