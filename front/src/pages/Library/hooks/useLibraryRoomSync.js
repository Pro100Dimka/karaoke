import { useEffect, useMemo, useRef } from "react";
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
  const localSongsRef = useLatestRef(localSongs);
  const songsSignature = useMemo(() => JSON.stringify(localSongs), [localSongs]);

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
    if (applyingRemoteUiRef.current) {
      applyingRemoteUiRef.current = false;
      return;
    }

    syncUi({ query });
  }, [query, room, syncUi]);

  useEffect(() => {
    if (!room?.host) return;
    syncUi({ songs: localSongsRef.current });
  }, [localSongsRef, participantCount, room?.host, songsSignature, syncUi]);
}
