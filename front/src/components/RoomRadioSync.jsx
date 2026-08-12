import { useEffect, useRef } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import { useRadio } from "../contexts/radio";

export default function RoomRadioSync() {
  const { room, roomUi, participants, syncUi } = useOnlineRoom();
  const { isPlaying, stationId, setStation, turnOff, turnOn } = useRadio();
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    if (!room?.host || applyingRemoteRef.current) return;
    syncUi({ radio: { isPlaying, stationId } });
  }, [isPlaying, participants.length, room?.host, stationId, syncUi]);

  useEffect(() => {
    if (!room || room.host || !roomUi?.radio) return;
    const remote = roomUi.radio;
    applyingRemoteRef.current = true;
    if (remote.stationId && remote.stationId !== stationId) {
      setStation(remote.stationId);
    } else if (remote.isPlaying && !isPlaying) {
      turnOn({ remember: false, fadeIn: true }).catch(() => {});
    } else if (!remote.isPlaying && isPlaying) {
      turnOff({ remember: false });
    }
    queueMicrotask(() => {
      applyingRemoteRef.current = false;
    });
  }, [
    isPlaying,
    room,
    roomUi?.__eventId,
    roomUi?.radio,
    setStation,
    stationId,
    turnOff,
    turnOn
  ]);

  return null;
}
