function createCommandId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function openKaraokeInRoom({
  songId,
  room,
  client,
  roomApi,
  isCurrentConnection,
  hostSongCommandRef,
  voice
}) {
  if (room && !room.host) return false;
  if (!isCurrentConnection()) return true;
  const revisionPayload = await roomApi?.getSongRevision?.(songId);
  const revision = revisionPayload?.revision;
  if (typeof revision !== "string" || !revision.startsWith("sha256:"))
    throw new Error("Не удалось определить версию содержимого песни");
  if (!isCurrentConnection()) return false;
  const command = { type: "open-karaoke", songId, commandId: createCommandId(), revision };
  const previousCommandId = hostSongCommandRef?.current?.commandId;
  if (previousCommandId && previousCommandId !== command.commandId)
    voice?.cancelTransfersByCommandId?.(previousCommandId);
  if (hostSongCommandRef) hostSongCommandRef.current = command;
  client?.send("sync", { state: command });
  return true;
}
