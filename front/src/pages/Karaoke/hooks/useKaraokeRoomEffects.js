import { useEffect, useRef } from "react";
import { createRoomSyncChannel } from "../../../services/roomSyncChannel";

export default function useKaraokeRoomEffects({ room, participantCount, volume, effects, syncUi }) {
  const channel = useRef(createRoomSyncChannel());
  useEffect(() => {
    channel.current = createRoomSyncChannel();
  }, [room?.id, room?.selfId, participantCount]);
  useEffect(() => {
    if (!room) return;
    const state = { volume, ...effects };
    if (channel.current.shouldSend(state)) syncUi({ participantEffects: state });
  }, [channel, effects, participantCount, room, syncUi, volume]);
}
