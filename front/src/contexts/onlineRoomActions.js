export async function openKaraokeInRoom({
  songId,
  room,
  client,
  roomApi,
  isCurrentConnection,
  pendingSongCommandRef,
  setTransferStatus
}) {
  const command = { type: "open-karaoke", songId };
  if (!room || room.host) {
    if (isCurrentConnection())
      client?.send("sync", { state: command });
    return true;
  }
  try {
    await roomApi.getSong(songId);
    if (!isCurrentConnection()) return false;
    client.send("sync", { state: command });
    return true;
  } catch {
    if (!isCurrentConnection()) return false;
    pendingSongCommandRef.current = { ...command, __originatedHere: true };
    setTransferStatus({ stage: "waiting", percent: 0 });
    client.send("sync", { state: { type: "song-request", songId, requesterId: room.selfId } });
    return false;
  }
}
