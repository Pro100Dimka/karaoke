import { useEffect, useMemo, useRef } from "react";
import { createRoomSyncChannel } from "../../../services/roomSyncChannel";
import { normalizeKaraokePreferences } from "../utils/preferences";

const valuesOf = (preferences) =>
  normalizeKaraokePreferences({
    musicVolume: preferences.musicVolume,
    vocalVolume: preferences.vocalVolume,
    melodyVolume: preferences.melodyVolume,
    speed: preferences.speed,
    keyShift: preferences.keyShift,
    showLyrics: preferences.showLyrics,
    showNotes: preferences.showNotes,
    autoHideConsole: preferences.autoHideConsole,
    effectPreset: preferences.effectPreset
  });

export default function useKaraokeRoomPreferences({ preferences, room, roomUi, syncUi, onReceive }) {
  const channel = useRef(createRoomSyncChannel());
  const local = useMemo(() => valuesOf(preferences), [preferences]);
  const localRef = useRef(local);
  const localBeforeGuest = useRef(null);
  localRef.current = local;

  useEffect(() => {
    const guest = room && !room.host;

    if (guest && !localBeforeGuest.current) localBeforeGuest.current = localRef.current;
    if (!guest && localBeforeGuest.current) {
      onReceive?.(localBeforeGuest.current);
      localBeforeGuest.current = null;
    }

    channel.current = createRoomSyncChannel(guest ? localRef.current : undefined);
  }, [onReceive, room?.host, room?.id, room?.selfId]);

  useEffect(() => {
    if (!room || !roomUi?.karaoke) return;

    const remote = valuesOf(roomUi.karaoke);
    if (channel.current.receiveState(remote, localRef.current)) onReceive?.(remote);
  }, [onReceive, room?.host, room?.id, roomUi?.__eventId, roomUi?.karaoke]);

  useEffect(() => {
    if (!room || typeof syncUi !== "function" || !channel.current.shouldSend(local)) return;
    Promise.resolve().then(() => syncUi({ karaoke: local })).catch(() => {});
  }, [local, room, syncUi]);
}
