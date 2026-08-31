import { useEffect, useMemo, useRef } from "react";
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

export default function useKaraokeRoomPreferences({
  preferences,
  room,
  roomUi,
  syncUi
}) {
  const remoteTarget = useRef(null);
  const sent = useRef("");
  const local = useMemo(() => valuesOf(preferences), [preferences]);
  const localSignature = JSON.stringify(local);
  const currentLocal = useRef(local);
  const currentPreferences = useRef(preferences);
  currentLocal.current = local;
  currentPreferences.current = preferences;

  useEffect(() => {
    remoteTarget.current = null;
    sent.current = room && !room.host ? JSON.stringify(currentLocal.current) : "";
  }, [room?.host, room?.id, room?.selfId]);

  useEffect(() => {
    if (!room || !roomUi?.karaoke) return;
    const remote = valuesOf(roomUi.karaoke);
    const remoteSignature = JSON.stringify(remote);
    const { current } = currentLocal;
    if (remoteSignature === JSON.stringify(current)) {
      remoteTarget.current = null;
      sent.current = remoteSignature;
      return;
    }
    remoteTarget.current = remoteSignature;
    Object.entries(remote).forEach(([key, value]) => {
      if (current[key] === value) return;
      const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
      currentPreferences.current[setter]?.(value);
    });
  }, [room?.id, roomUi?.__eventId, roomUi?.karaoke]);

  useEffect(() => {
    if (!room) return;
    if (remoteTarget.current !== null) {
      if (remoteTarget.current === localSignature) {
        remoteTarget.current = null;
        sent.current = localSignature;
      }
      return;
    }
    if (sent.current === localSignature) return;
    sent.current = localSignature;
    syncUi({ karaoke: local });
  }, [local, localSignature, room, syncUi]);

}
