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

export default function useKaraokeRoomPreferences({ preferences, room, roomUi, syncUi }) {
  const connected = Boolean(room),
    roomId = room?.id,
    selfId = room?.selfId,
    host = room?.host;
  const channel = useRef(createRoomSyncChannel());
  const local = useMemo(() => valuesOf(preferences), [preferences]);
  const localSignature = JSON.stringify(local);
  const currentLocal = useRef(local);
  const currentPreferences = useRef(preferences);
  currentLocal.current = local;
  currentPreferences.current = preferences;

  useEffect(() => {
    channel.current = createRoomSyncChannel(connected && !host ? currentLocal.current : undefined);
  }, [connected, host, roomId, selfId]);

  useEffect(() => {
    if (!connected || !roomUi?.karaoke) return;
    const remote = valuesOf(roomUi.karaoke);
    const { current } = currentLocal;
    if (!channel.current.receiveState(remote, current)) return;
    Object.entries(remote).forEach(([key, value]) => {
      if (current[key] === value) return;
      const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
      currentPreferences.current[setter]?.(value);
    });
  }, [connected, roomId, roomUi?.__eventId, roomUi?.karaoke]);

  useEffect(() => {
    if (!room) return;
    if (!channel.current.shouldSend(local)) return;
    syncUi({ karaoke: local });
  }, [local, localSignature, room, syncUi]);
}
