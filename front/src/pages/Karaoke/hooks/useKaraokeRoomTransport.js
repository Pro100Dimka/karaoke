import { useCallback, useEffect, useRef } from "react";
import useLatestRef from "../../../hooks/useLatestRef";
import { createRoomSyncChannel } from "../../../services/roomSyncChannel";
import { createPlayerSyncCommand } from "../utils/transport";
import { formatError } from "../utils/recordingSession";

const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export default function useKaraokeRoomTransport({
  onlineRoom,
  songId,
  instrumentalRef,
  isPlaying,
  navigate,
  seekTo,
  stop,
  togglePlay,
  setRecordingError
}) {
  const room = onlineRoom?.room;
  const syncCommand = onlineRoom?.syncCommand;
  const clockNow = onlineRoom?.roomClockNow;
  const channel = useRef(createRoomSyncChannel());
  const seekRef = useLatestRef(seekTo);
  const stopRef = useLatestRef(stop);
  const toggleRef = useLatestRef(togglePlay);

  const broadcast = useCallback(
    (action, position, executeAt = null) => {
      if (!room || !songId || typeof syncCommand !== "function") return;
      Promise.resolve()
        .then(() => syncCommand(createPlayerSyncCommand(action, songId, position, executeAt)))
        .catch(() => {});
    },
    [room, songId, syncCommand]
  );

  useEffect(() => {
    if (!room?.host || !isPlaying || !songId) return;
    const timer = setInterval(() => {
      const position = instrumentalRef.current?.currentTime;
      if (Number.isFinite(position)) broadcast("sync", position);
    }, 500);
    return () => clearInterval(timer);
  }, [broadcast, instrumentalRef, isPlaying, room?.host, songId]);

  useEffect(() => {
    channel.current = createRoomSyncChannel();
  }, [room?.id, songId]);

  const command = onlineRoom?.roomCommand;
  useEffect(() => {
    if (
      room?.host ||
      command?.type !== "karaoke-player" ||
      !command.commandId ||
      !sameId(command.songId, songId) ||
      !instrumentalRef.current ||
      !channel.current.acceptCommand(command.commandId)
    ) {
      return;
    }

    const position = Number(command.position);
    const sampledAt = Number(command.positionAt);
    const sentAt =
      command.positionAt != null && Number.isFinite(sampledAt)
        ? sampledAt
        : Number(command.__serverSentAt);
    const receivedAt = Number(command.__receivedServerAt);
    const executeAt = Number(command.executeAt);
    const serverNow = typeof clockNow === "function" ? Number(clockNow()) : receivedAt;
    const delivery =
      ["play", "sync"].includes(command.action) &&
      Number.isFinite(sentAt) &&
      Number.isFinite(receivedAt)
        ? Math.max(0, (receivedAt - sentAt) / 1000)
        : 0;
    const late =
      command.action === "play" && Number.isFinite(executeAt) && Number.isFinite(serverNow)
        ? Math.max(0, (serverNow - executeAt) / 1000)
        : delivery;
    const target = position + late;

    if (
      Number.isFinite(target) &&
      (command.action !== "sync" || Math.abs(instrumentalRef.current.currentTime - target) > 0.04)
    ) {
      seekRef.current?.(target, { broadcast: false });
    }

    const actions = {
      play: () => toggleRef.current?.({ broadcast: false, forcePlaying: true }),
      pause: () => toggleRef.current?.({ broadcast: false, forcePlaying: false }),
      stop: async () => {
        const stopped = await stopRef.current?.({ broadcast: false });
        if (stopped) navigate("/", { replace: true, state: { fromKaraokeFade: true } });
        return stopped;
      }
    };
    const action = Object.hasOwn(actions, command.action) ? actions[command.action] : null;
    if (!action) return;

    const run = () =>
      Promise.resolve()
        .then(action)
        .catch((error) =>
          setRecordingError(formatError("karaoke.failedToExecuteRoomCommand", error))
        );
    const delay =
      command.action === "play" && Number.isFinite(executeAt) && Number.isFinite(serverNow)
        ? Math.max(0, executeAt - serverNow)
        : 0;

    if (!delay) {
      run();
      return;
    }

    let executed = false;
    const timer = setTimeout(() => {
      executed = true;
      run();
    }, delay);

    return () => {
      clearTimeout(timer);
      if (!executed) channel.current.cancelCommand(command.commandId);
    };
  }, [
    clockNow,
    command,
    instrumentalRef,
    navigate,
    room?.host,
    seekRef,
    setRecordingError,
    songId,
    stopRef,
    toggleRef
  ]);

  return broadcast;
}
