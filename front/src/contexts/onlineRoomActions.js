export async function openKaraokeInRoom({
  songId,
  room,
  client,
  roomApi,
  isCurrentConnection,
  pendingSongCommandRef,
  setVoiceError
}) {
  const command = { type: "open-karaoke", songId };

  if (!room || room.host) {
    if (isCurrentConnection()) client?.send("sync", { state: command });
    return true;
  }

  try {
    await roomApi.getSong(songId);
    if (!isCurrentConnection()) return false;
    client.send("sync", { state: command });
    return true;
  } catch {
    if (!isCurrentConnection()) return false;
    pendingSongCommandRef.current = {
      ...command,
      __originatedHere: true
    };
    setVoiceError("Получаем песню от ведущего…");
    client.send("sync", {
      state: {
        type: "song-request",
        songId,
        requesterId: room.selfId
      }
    });
    return false;
  }
}
