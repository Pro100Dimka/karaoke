import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useOnlineRoom } from "../contexts/OnlineRoomContext";

const ROOM_NAVIGATION = {
  "open-karaoke": () => null,
  "start-karaoke": (command) =>
    command.songId
      ? ["/karaoke", { state: { songId: command.songId, autoPlay: false, roomPrepared: true } }]
      : null,
  "open-library": () => ["/"]
};

export function navigateRoomCommand(command, navigate) {
  const handler = ROOM_NAVIGATION[command?.type];
  const target = Object.hasOwn(ROOM_NAVIGATION, command?.type) ? handler(command) : null;
  if (target) navigate(...target);
}

export function useOnlineRoomNavigation() {
  const navigate = useNavigate();
  const { roomCommand } = useOnlineRoom();

  useEffect(() => {
    navigateRoomCommand(roomCommand, navigate);
  }, [navigate, roomCommand]);
}
