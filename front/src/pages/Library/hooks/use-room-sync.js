import { useEffect, useRef } from "react";
import { api } from "../../../api/client";

// Must stay within the guest "ui" validation the room server enforces
// (cloudflare/src/worker.js, KaraokeRoom.webSocketMessage): a payload over
// either limit is rejected outright, closing the guest's connection.
const MAX_PARTICIPANT_SONGS = 500;
const MAX_PARTICIPANT_SONGS_JSON_LENGTH = 120 * 1024;

function capParticipantSongs(songs) {
  let capped = songs.length > MAX_PARTICIPANT_SONGS ? songs.slice(0, MAX_PARTICIPANT_SONGS) : songs;
  while (
    capped.length > 0 &&
    JSON.stringify({ participantSongs: capped }).length > MAX_PARTICIPANT_SONGS_JSON_LENGTH
  ) {
    capped = capped.slice(0, capped.length - 1);
  }
  return capped;
}

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
      if (!cancelled) syncUi({ participantSongs: capParticipantSongs(songs) });
    });
    return () => {
      cancelled = true;
    };
  }, [localSongs, participantCount, room?.selfId, syncUi]);
}
