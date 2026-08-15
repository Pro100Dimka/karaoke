export function openKaraokeInRoom({ songId, room, client, isCurrentConnection }) {
  if (room && !room.host) return false;
  if (isCurrentConnection()) client?.send("sync", { state: { type: "open-karaoke", songId } });
  return true;
}
