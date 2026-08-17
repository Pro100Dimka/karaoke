import { useEffect, useRef } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import { useRadio } from "../contexts/radio";

const REMOTE_SETTLE_TIMEOUT_MS = 5000;

export default function RoomRadioSync() {
  const { room, roomUi, syncUi } = useOnlineRoom();
  const { isPlaying, stationId, stations, setStation, setVolume, turnOff, turnOn, volume } =
    useRadio();
  const remoteTargetRef = useRef(null);
  const lastSentRef = useRef("");
  const radioStateRef = useRef({ isPlaying, stationId, volume });
  radioStateRef.current = { isPlaying, stationId, volume };

  // Remote events are declared first so an already-present room state wins on
  // mount and cannot be overwritten by stale local radio state.
  useEffect(() => {
    if (!room || !roomUi?.radio) return;
    const { current } = radioStateRef;
    const remote = roomUi.radio;
    const nextStationId = remote.stationId || current.stationId;
    const nextVolume = Number.isFinite(Number(remote.volume))
      ? Number(remote.volume)
      : current.volume;
    const signature = `${nextStationId}:${Boolean(remote.isPlaying)}:${nextVolume.toFixed(3)}`;
    const currentSignature = `${current.stationId}:${current.isPlaying}:${current.volume.toFixed(3)}`;
    if (signature === currentSignature) {
      remoteTargetRef.current = null;
      lastSentRef.current = signature;
      return;
    }

    remoteTargetRef.current = { signature, startedAt: Date.now() };
    if (remote.stationId && remote.stationId !== current.stationId) setStation(remote.stationId);
    if (Math.abs(nextVolume - current.volume) > 0.001) setVolume(nextVolume);
    if (remote.isPlaying && !current.isPlaying) {
      Promise.resolve(
        turnOn({
          remember: false,
          fadeIn: true,
          targetStation: stations.find(({ id }) => id === nextStationId) || stations[0]
        })
      ).catch(() => {
        remoteTargetRef.current = null;
      });
    } else if (!remote.isPlaying && current.isPlaying) turnOff({ remember: false });
  }, [room, roomUi?.__eventId, roomUi?.radio, setStation, setVolume, stations, turnOff, turnOn]);

  useEffect(() => {
    if (!room) return;
    const signature = `${stationId}:${isPlaying}:${volume.toFixed(3)}`;
    const target = remoteTargetRef.current;
    if (target) {
      if (signature === target.signature) {
        remoteTargetRef.current = null;
        lastSentRef.current = signature;
        return;
      }
      if (Date.now() - target.startedAt < REMOTE_SETTLE_TIMEOUT_MS) return;
      remoteTargetRef.current = null;
    }
    if (lastSentRef.current === signature) return;
    lastSentRef.current = signature;
    syncUi({ radio: { isPlaying, stationId, volume } });
  }, [isPlaying, room, stationId, syncUi, volume]);

  return null;
}
