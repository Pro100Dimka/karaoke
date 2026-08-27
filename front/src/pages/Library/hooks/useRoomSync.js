import { useEffect, useRef } from "react";
import { api } from "../../../api/client";

const MAX_SONGS = 500;
const MAX_BYTES = 120 * 1024;
const encodedBytes = (value) => new TextEncoder().encode(value).byteLength;
export const capParticipantSongs = (songs) => {
  const candidates = songs.slice(0, MAX_SONGS);
  // The Worker enforces UTF-8 bytes, not JavaScript character count. Cyrillic
  // metadata is commonly two bytes per character, so the old length check
  // could send >128 KiB and the Worker correctly closed the whole room.
  // Binary search avoids repeatedly serializing almost the entire library
  // hundreds of times when a large list needs trimming.
  let lower = 0;
  let upper = candidates.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (encodedBytes(JSON.stringify({ songs: candidates.slice(0, middle) })) <= MAX_BYTES)
      lower = middle;
    else upper = middle - 1;
  }
  return candidates.slice(0, lower);
};
// The revisions endpoint caps a single request to the same count (see
// schemas.SongRevisionsRequest), so a library larger than that still needs
// chunking -- just far fewer requests than one per song.
const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
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
    if (!room?.selfId) return undefined;
    let active = true;
    const doneIds = localSongs.filter((song) => song?.status === "done").map((song) => song.id);
    // A handful of batched requests for every "done" song's revision instead
    // of one request per song -- with a large library this turned publishing
    // it to the room into a burst of N requests all serializing on the
    // backend's library-wide lock (see
    // song_package_service.content_revisions_for_songs).
    Promise.all(
      chunk(doneIds, MAX_SONGS).map((ids) => api.getSongRevisions(ids).catch(() => null))
    ).then((results) => {
      if (!active) return;
      const revisionById = new Map();
      results.forEach((result) => {
        (result?.revisions || []).forEach((entry) => {
          if (entry.revision) revisionById.set(entry.song_id, entry.revision);
        });
      });
      const songs = localSongs.map((song) => {
        const owned = { ...song, __roomOwnerId: room.selfId };
        const revision = revisionById.get(song.id);
        return revision ? { ...owned, __roomRevision: revision } : owned;
      });
      // Every participant publishes their own local library under the
      // worker's allowed `songs` contract. `participantSongs` was silently
      // discarded for guests, so the host could not know that a guest
      // already had (or was missing) a particular revision.
      syncUi({ songs: capParticipantSongs(songs) });
    });
    return () => {
      active = false;
    };
  }, [localSongs, participantCount, room?.selfId, syncUi]);
}
