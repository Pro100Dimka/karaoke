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
  const applyingRemoteUiRef = useRef(false);
  const queryRef = useLatestRef(query);
  const roomQueryRef = useLatestRef(roomQuery);
  useEffect(() => {
    const remoteQuery = roomQueryRef.current;
    if (typeof remoteQuery !== "string") return;
    if (remoteQuery === queryRef.current) {
      applyingRemoteUiRef.current = false;
      return;
    }
    applyingRemoteUiRef.current = true;
    setQuery(remoteQuery);
  }, [queryRef, roomEventId, roomQueryRef, setQuery]);
  useEffect(() => {
    if (!room) return;
    if (applyingRemoteUiRef.current) return;
    syncUi({ query });
  }, [query, room, syncUi]);
  useEffect(() => {
    if (!room?.host) return;
    syncUi({ songs: localSongs });
  }, [localSongs, participantCount, room?.host, syncUi]);
}
