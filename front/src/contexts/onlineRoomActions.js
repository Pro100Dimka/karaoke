function createCommandId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function openKaraokeInRoom({ songId, room, client, isCurrentConnection, hostSongCommandRef }) {
  if (room && !room.host) return false;
  if (!isCurrentConnection()) return true;
  const command = { type: "open-karaoke", songId, commandId: createCommandId() };
  if (hostSongCommandRef) hostSongCommandRef.current = command;
  client?.send("sync", { state: command });
  return true;
}
