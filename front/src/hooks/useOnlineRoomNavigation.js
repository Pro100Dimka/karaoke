import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { useOnlineRoom } from "../contexts/OnlineRoomContext";

const ROOM_COMMAND_HANDLERS = {
  "open-karaoke": ({ command, navigate }) => {
    if (!command.songId) return;

    navigate("/karaoke", {
      state: {
        songId: command.songId
      }
    });
  },

  "open-library": ({ navigate }) => {
    navigate("/");
  }
};

export function useOnlineRoomNavigation() {
  const navigate = useNavigate();
  const { roomCommand } = useOnlineRoom();

  useEffect(() => {
    if (!roomCommand) return;

    const handleCommand = ROOM_COMMAND_HANDLERS[roomCommand.type];

    handleCommand?.({
      command: roomCommand,
      navigate
    });
  }, [navigate, roomCommand]);
}
