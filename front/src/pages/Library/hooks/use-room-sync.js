import { useEffect, useRef } from "react";
import { api } from "../../../api/client";

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
  const pendingRemoteQueryRef = useRef(null);
  useEffect(() => {
    const remoteQuery = roomQuery;
    if (typeof remoteQuery !== "string" || remoteQuery === query) return;
    pendingRemoteQueryRef.current = remoteQuery;
    setQuery(remoteQuery);
  }, [query, roomEventId, roomQuery, setQuery]);

  useEffect(() => {
    if (!room) return;
    if (pendingRemoteQueryRef.current !== null) {
      if (pendingRemoteQueryRef.current === query) pendingRemoteQueryRef.current = null;
      return;
    }
    syncUi({ query });
  }, [query, room, syncUi]);

  useEffect(() => {
    if (room?.host) syncUi({ songs: localSongs });
  }, [localSongs, room?.host, syncUi]);

  useEffect(() => {
    if (!room?.selfId) return undefined;
    let cancelled = false;
    Promise.all(
      localSongs.map(async (song) => {
        if (song?.status !== "done") return { ...song, __roomOwnerId: room.selfId };
        try {
          const revision = await api.getSongRevision(song.id);
          return { ...song, __roomOwnerId: room.selfId, __roomRevision: revision?.revision };
        } catch {
          return { ...song, __roomOwnerId: room.selfId };
        }
      })
    ).then((songs) => {
      if (!cancelled) syncUi({ participantSongs: songs });
    });
    return () => {
      cancelled = true;
    };
  }, [localSongs, participantCount, room?.selfId, syncUi]);
}
