import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useOnlineRoom } from "../contexts/OnlineRoomContext";

export function navigateRoomCommand(command, navigate) {
  if (command?.type === "open-karaoke" && command.songId) {
    navigate("/karaoke", { state: { songId: command.songId } });
  } else if (command?.type === "open-library") {
    navigate("/");
  }
}

export function useOnlineRoomNavigation() {
  const navigate = useNavigate();
  const { roomCommand } = useOnlineRoom();

  useEffect(() => {
    navigateRoomCommand(roomCommand, navigate);
  }, [navigate, roomCommand]);
}
