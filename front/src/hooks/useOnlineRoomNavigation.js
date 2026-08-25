import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import { setGlobalRouteBlackout } from "../utils/route-blackout";

// Matches the fade-out delay Library uses before navigating the host into
// Karaoke (see Library/use-library.js openKaraoke) so guests get the same
// transition instead of the song appearing instantly with no fade.
const ROOM_KARAOKE_TRANSITION_MS = 920;

const routes = {
  "open-karaoke": () => null,
  "start-karaoke": ({ songId }) =>
    songId ? ["/karaoke", { state: { songId, autoPlay: false, roomPrepared: true } }] : null,
  "open-library": () => ["/"]
};

export function navigateRoomCommand(command, navigate) {
  const target = routes[command?.type]?.(command);
  if (!target) return undefined;
  if (command.type !== "start-karaoke") {
    navigate(...target);
    return undefined;
  }
  setGlobalRouteBlackout(true);
  const timer = setTimeout(() => navigate(...target), ROOM_KARAOKE_TRANSITION_MS);
  return () => clearTimeout(timer);
}

export function useOnlineRoomNavigation() {
  const navigate = useNavigate();
  const { roomCommand } = useOnlineRoom();
  useEffect(() => navigateRoomCommand(roomCommand, navigate), [navigate, roomCommand]);
}
