import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useOnlineRoom } from "../contexts/OnlineRoomContext";

const routes = {
  "open-karaoke": () => null,
  "start-karaoke": ({ songId }) =>
    songId ? ["/karaoke", { state: { songId, autoPlay: false, roomPrepared: true } }] : null,
  "open-library": () => ["/"]
};

export function navigateRoomCommand(command, navigate) {
  const target = routes[command?.type]?.(command);
  if (target) navigate(...target);
}

export function useOnlineRoomNavigation() {
  const navigate = useNavigate();
  const { roomCommand } = useOnlineRoom();
  useEffect(() => navigateRoomCommand(roomCommand, navigate), [navigate, roomCommand]);
}
