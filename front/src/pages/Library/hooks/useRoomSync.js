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
  filters,
  room,
  roomEventId,
  roomQuery,
  roomFilters,
  participantCount,
  setQuery,
  setFilters,
  syncUi
}) {
  const remote = useRef(null);
  const remoteFilters = useRef(null);
  const sentQuery = useRef(null);
  const sentFilters = useRef(null);
  const currentQuery = useRef(query);
  const currentFilters = useRef(filters);
  currentQuery.current = query;
  currentFilters.current = filters;

  useEffect(() => {
    remote.current = null;
    remoteFilters.current = null;
    sentQuery.current = room && !room.host ? currentQuery.current : null;
    sentFilters.current = room && !room.host ? JSON.stringify(currentFilters.current) : null;
  }, [room?.host, room?.id, room?.selfId]);

  useEffect(() => {
    if (typeof roomQuery === "string" && roomQuery !== currentQuery.current) {
      remote.current = roomQuery;
      sentQuery.current = roomQuery;
      setQuery(roomQuery);
    }
  }, [roomEventId, roomQuery, setQuery]);

  useEffect(() => {
    if (!room) return;
    if (remote.current !== null) {
      if (remote.current === query) remote.current = null;
      return;
    }
    if (sentQuery.current === query) return;
    sentQuery.current = query;
    syncUi({ query });
  }, [query, room, syncUi]);

  useEffect(() => {
    if (!roomFilters || typeof roomFilters !== "object" || Array.isArray(roomFilters)) return;
    const incoming = JSON.stringify(roomFilters);
    if (incoming === JSON.stringify(currentFilters.current)) {
      sentFilters.current = incoming;
      return;
    }
    remoteFilters.current = incoming;
    sentFilters.current = incoming;
    setFilters(roomFilters);
  }, [roomEventId, roomFilters, setFilters]);

  useEffect(() => {
    if (!room) return;
    const current = JSON.stringify(filters);
    if (remoteFilters.current !== null) {
      if (remoteFilters.current === current) remoteFilters.current = null;
      return;
    }
    if (sentFilters.current === current) return;
    sentFilters.current = current;
    syncUi({ filters });
  }, [filters, room, syncUi]);

  useEffect(() => {
    if (room?.host && participantCount)
      syncUi({ query: currentQuery.current, filters: currentFilters.current });
  }, [participantCount, room?.host, syncUi]);
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
