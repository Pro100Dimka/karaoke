import { useEffect, useRef } from "react";
import { api } from "../../../api/client";

const MAX_SONGS = 500;
const MAX_BYTES = 120 * 1024;
export const capParticipantSongs = (songs) => {
  const result = songs.slice(0, MAX_SONGS);
  while (result.length && JSON.stringify({ participantSongs: result }).length > MAX_BYTES)
    result.pop();
  return result;
};

export default function useLibraryRoomSync({
  localSongs,
  query,
  room,
  roomEventId,
  roomQuery,
  participantCount,
  setQuery,
  syncUi
}) {
  const remote = useRef(null);
  useEffect(() => {
    if (typeof roomQuery === "string" && roomQuery !== query) {
      remote.current = roomQuery;
      setQuery(roomQuery);
    }
  }, [query, roomEventId, roomQuery, setQuery]);
  useEffect(() => {
    if (!room) return;
    if (remote.current !== null) {
      if (remote.current === query) remote.current = null;
      return;
    }
    syncUi({ query });
  }, [query, room, syncUi]);
  useEffect(() => {
    if (room?.host) syncUi({ songs: localSongs });
  }, [localSongs, room?.host, syncUi]);
  useEffect(() => {
    if (!room?.selfId) return undefined;
    let active = true;
    Promise.all(
      localSongs.map(async (song) => {
        const owned = { ...song, __roomOwnerId: room.selfId };
        if (song?.status !== "done") return owned;
        try {
          const revision = await api.getSongRevision(song.id);
          return { ...owned, __roomRevision: revision?.revision };
        } catch {
          return owned;
        }
      })
    ).then((songs) => active && syncUi({ participantSongs: capParticipantSongs(songs) }));
    return () => {
      active = false;
    };
  }, [localSongs, participantCount, room?.selfId, syncUi]);
}
