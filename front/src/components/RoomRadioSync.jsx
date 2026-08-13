import { useEffect, useRef } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import { useRadio } from "../contexts/radio";

export default function RoomRadioSync() {
  const { room, roomUi, participants, syncUi } = useOnlineRoom();
  const { isPlaying, stationId, stations, setStation, turnOff, turnOn } =
    useRadio();
  const applyingRemoteRef = useRef(false);
  const appliedSignatureRef = useRef("");

  useEffect(() => {
    if (!room || applyingRemoteRef.current) return;
    const signature = `${stationId}:${isPlaying}`;
    if (appliedSignatureRef.current === signature) {
      appliedSignatureRef.current = "";
      return;
    }
    syncUi({ radio: { isPlaying, stationId } });
  }, [isPlaying, participants.length, room, stationId, syncUi]);

  useEffect(() => {
    if (!room || !roomUi?.radio) return;
    const remote = roomUi.radio;
    const nextStationId = remote.stationId || stationId;
    const signature = `${nextStationId}:${Boolean(remote.isPlaying)}`;
    if (signature === `${stationId}:${isPlaying}`) return;
    applyingRemoteRef.current = true;
    appliedSignatureRef.current = signature;
    if (remote.stationId && remote.stationId !== stationId) {
      setStation(remote.stationId);
    }
    if (remote.isPlaying && !isPlaying) {
      turnOn({
        remember: false,
        fadeIn: true,
        targetStation:
          stations.find(({ id }) => id === nextStationId) || stations[0]
      }).catch(() => {});
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
    stations,
    stationId,
    turnOff,
    turnOn
  ]);

  return null;
}
