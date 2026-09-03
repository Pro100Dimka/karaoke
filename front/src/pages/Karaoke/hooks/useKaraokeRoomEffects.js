import { useEffect, useRef } from "react";
import { createRoomSyncChannel } from "../../../services/roomSyncChannel";

export default function useKaraokeRoomEffects({ room, participantCount, volume, effects, syncUi }) {
  const channel = useRef(createRoomSyncChannel());

  useEffect(() => {
    channel.current = createRoomSyncChannel();
  }, [participantCount, room?.id, room?.selfId]);

  useEffect(() => {
    if (!room || typeof syncUi !== "function") return;
    const state = { volume, ...effects };
    if (channel.current.shouldSend(state)) {
      Promise.resolve(syncUi?.({ participantEffects: state })).catch(() => {});
    }
  }, [effects, participantCount, room, syncUi, volume]);
}
