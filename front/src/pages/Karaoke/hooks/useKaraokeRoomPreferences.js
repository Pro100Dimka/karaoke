import { useEffect, useMemo, useRef } from "react";
import { createRoomSyncChannel } from "../../../services/roomSyncChannel";
import { normalizeKaraokePreferences } from "../utils/preferences";

const KEYS = [
  "musicVolume",
  "vocalVolume",
  "melodyVolume",
  "speed",
  "keyShift",
  "showLyrics",
  "showNotes",
  "autoHideConsole",
  "effectPreset"
];
const valuesOf = (state) =>
  normalizeKaraokePreferences(Object.fromEntries(KEYS.map((key) => [key, state[key]])));

export default function useKaraokeRoomPreferences({ preferences, room, roomUi, syncUi, onReceive }) {
  const channel = useRef(createRoomSyncChannel());
  const local = useMemo(() => valuesOf(preferences), [preferences]);
  const localRef = useRef(local);
  localRef.current = local;

  useEffect(() => {
    channel.current = createRoomSyncChannel(room && !room.host ? localRef.current : undefined);
  }, [room?.host, room?.id, room?.selfId]);

  useEffect(() => {
    if (!room || !roomUi?.karaoke) return;
    const remote = valuesOf(roomUi.karaoke);
    if (channel.current.receiveState(remote, localRef.current)) onReceive?.(remote);
  }, [onReceive, room, roomUi?.__eventId, roomUi?.karaoke]);

  useEffect(() => {
    if (!room || typeof syncUi !== "function" || !channel.current.shouldSend(local)) return;
    Promise.resolve(syncUi({ karaoke: local })).catch(() => {});
  }, [local, room, syncUi]);
}
