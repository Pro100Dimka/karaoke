import { useEffect, useRef } from "react";
import useLatestRef from "../../../hooks/useLatestRef";

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
  const roomQueryRef = useLatestRef(roomQuery);

  useEffect(() => {
    const remoteQuery = roomQueryRef.current;
    if (typeof remoteQuery !== "string" || remoteQuery === query) return;
    pendingRemoteQueryRef.current = remoteQuery;
    setQuery(remoteQuery);
  }, [query, roomEventId, roomQueryRef, setQuery]);

  useEffect(() => {
    if (!room) return;
    if (pendingRemoteQueryRef.current === query) {
      pendingRemoteQueryRef.current = null;
      return;
    }
    syncUi({ query });
  }, [query, room, syncUi]);

  useEffect(() => {
    if (room?.host) syncUi({ songs: localSongs });
  }, [localSongs, participantCount, room?.host, syncUi]);
}
