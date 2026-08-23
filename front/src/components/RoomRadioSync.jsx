import { useEffect, useRef } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import { useRadio } from "../contexts/radio";

const SETTLE_MS = 5000;
const signature = ({ stationId, isPlaying, volume }) =>
  `${stationId}:${Boolean(isPlaying)}:${Number(volume).toFixed(3)}`;

export default function RoomRadioSync() {
  const { participants, room, roomUi, syncUi } = useOnlineRoom();
  const radio = useRadio();
  const current = useRef(radio);
  const target = useRef(null);
  const sent = useRef("");
  current.current = radio;

  useEffect(() => {
    target.current = null;
    sent.current = room && !room.host ? signature(current.current) : "";
  }, [room?.host, room?.id, room?.selfId]);

  useEffect(() => {
    if (!room || !roomUi?.radio) return;
    const local = current.current;
    const remote = {
      stationId: roomUi.radio.stationId || local.stationId,
      isPlaying: roomUi.radio.isPlaying,
      volume: Number.isFinite(Number(roomUi.radio.volume))
        ? Number(roomUi.radio.volume)
        : local.volume
    };
    const next = signature(remote);
    if (next === signature(local)) {
      target.current = null;
      sent.current = next;
      return;
    }
    target.current = { signature: next, startedAt: Date.now() };
    if (roomUi.radio.stationId && remote.stationId !== local.stationId)
      local.setStation(remote.stationId);
    if (Math.abs(remote.volume - local.volume) > 0.001) local.setVolume(remote.volume);
    if (remote.isPlaying && !local.isPlaying) {
      Promise.resolve(
        local.turnOn({
          remember: false,
          fadeIn: true,
          targetStation:
            local.stations.find(({ id }) => id === remote.stationId) || local.stations[0]
        })
      ).catch(() => {
        target.current = null;
      });
    } else if (!remote.isPlaying && local.isPlaying) local.turnOff({ remember: false });
  }, [room?.id, roomUi?.__eventId, roomUi?.radio]);

  useEffect(() => {
    if (!room) return;
    const next = signature(radio);
    if (target.current) {
      if (next === target.current.signature) {
        target.current = null;
        sent.current = next;
        return;
      }
      if (Date.now() - target.current.startedAt < SETTLE_MS) return;
      target.current = null;
    }
    if (sent.current === next) return;
    sent.current = next;
    syncUi({
      radio: { isPlaying: radio.isPlaying, stationId: radio.stationId, volume: radio.volume }
    });
  }, [radio.isPlaying, radio.stationId, radio.volume, room, syncUi]);
  useEffect(() => {
    if (!room?.host || !participants.length) return;
    const value = current.current;
    syncUi({
      radio: { isPlaying: value.isPlaying, stationId: value.stationId, volume: value.volume }
    });
  }, [participants.length, room?.host, syncUi]);

  return null;
}
