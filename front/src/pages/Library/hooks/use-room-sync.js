import { useEffect, useRef } from "react";

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
  }, [localSongs, participantCount, room?.host, syncUi]);
}
