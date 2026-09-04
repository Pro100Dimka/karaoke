import { useEffect, useRef } from "react";
import { api } from "../../../api/client";

const MAX_SONGS = 500;
const MAX_BYTES = 120 * 1024;
const bytes = (value) => new TextEncoder().encode(value).byteLength;
const json = JSON.stringify;

export const capParticipantSongs = (songs) => {
  const list = songs.slice(0, MAX_SONGS);
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (bytes(json({ songs: list.slice(0, mid) })) <= MAX_BYTES) low = mid;
    else high = mid - 1;
  }
  return list.slice(0, low);
};

const chunks = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

function useSharedValue({ room, eventId, remote, value, setValue, syncUi, key, valid, serialize = String }) {
  const state = useRef({ remote: null, sent: null, current: value });
  state.current.current = value;

  useEffect(() => {
    state.current.remote = null;
    state.current.sent = room && !room.host ? serialize(state.current.current) : null;
  }, [room?.host, room?.id, room?.selfId, serialize]);

  useEffect(() => {
    if (!valid(remote)) return;
    const incoming = serialize(remote);
    if (incoming !== serialize(state.current.current)) {
      state.current.remote = incoming;
      setValue(remote);
    }
    state.current.sent = incoming;
  }, [eventId, remote, setValue, serialize, valid]);

  useEffect(() => {
    if (!room) return;
    const current = serialize(value);
    if (state.current.remote !== null) {
      if (state.current.remote === current) state.current.remote = null;
      return;
    }
    if (state.current.sent === current) return;
    state.current.sent = current;
    syncUi({ [key]: value });
  }, [key, room, serialize, syncUi, value]);
}

const isString = (value) => typeof value === "string";
const isBoolean = (value) => typeof value === "boolean";
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

export default function useLibraryRoomSync({
  localSongs,
  query,
  filters,
  filtersOpen,
  room,
  roomEventId,
  roomQuery,
  roomFilters,
  roomFiltersOpen,
  participantCount,
  setQuery,
  setFilters,
  setFiltersOpen,
  syncUi
}) {
  useSharedValue({
    room,
    eventId: roomEventId,
    remote: roomQuery,
    value: query,
    setValue: setQuery,
    syncUi,
    key: "query",
    valid: isString
  });

  useSharedValue({
    room,
    eventId: roomEventId,
    remote: roomFilters,
    value: filters,
    setValue: setFilters,
    syncUi,
    key: "filters",
    valid: isObject,
    serialize: json
  });

  useSharedValue({
    room,
    eventId: roomEventId,
    remote: roomFiltersOpen,
    value: filtersOpen,
    setValue: setFiltersOpen,
    syncUi,
    key: "libraryFiltersOpen",
    valid: isBoolean
  });

  useEffect(() => {
    if (!room?.selfId) return;
    let active = true;
    const ids = localSongs.filter(({ status } = {}) => status === "done").map(({ id }) => id);

    Promise.all(chunks(ids, MAX_SONGS).map((chunk) => api.getSongRevisions(chunk).catch(() => null))).then(
      (results) => {
        if (!active) return;
        const revisions = new Map();
        results.forEach((result) =>
          (result?.revisions || []).forEach(({ song_id, revision }) => {
            if (revision) revisions.set(String(song_id), revision);
          })
        );

        const songs = localSongs.map((song) => {
          const revision = revisions.get(String(song.id));
          return {
            ...song,
            __roomOwnerId: room.selfId,
            ...(revision && { __roomRevision: revision })
          };
        });

        syncUi({ songs: capParticipantSongs(songs) });
      }
    );

    return () => {
      active = false;
    };
  }, [localSongs, participantCount, room?.selfId, syncUi]);
}
