// Node's direct ESM tests require explicit extensions for these source imports.
// eslint-disable-next-line import/extensions
import { normalizeRoomId } from "../services/onlineRoom.js";
// eslint-disable-next-line import/extensions
import { getErrorMessage } from "../utils/errors.js";

const createEventId = (prefix = "room") =>
  `${prefix}-${Date.now()}-${Math.random()}`;

export function upsertParticipant(items, participant) {
  if (!participant?.id) return items;

  const index = items.findIndex((item) => item.id === participant.id);
  if (index < 0) return [...items, participant];

  const next = [...items];
  next[index] = { ...next[index], ...participant };
  return next;
}

export function createOnlineRoomMessageHandler(options) {
  const {
    id,
    client,
    voice,
    roomApi,
    isCurrentConnection = () => true,
    roomRef: activeRoomRef,
    intentionalDisconnectRef: disconnectIntentRef,
    pendingSongCommandRef: pendingCommandRef,
    cleanupConnection,
    setRoom,
    setParticipants,
    setRoomUi,
    setRoomCommand,
    setVoiceError
  } = options;
  return (message) => {
    if (!isCurrentConnection()) return;

    if (message.type === "room-state") {
      const { self } = message;
      if (self) {
        setRoom({
          id: normalizeRoomId(id),
          selfId: self.id,
          host: self.role === "host",
          role: self.role
        });
      }
      setParticipants(message.participants || []);
      return;
    }

    if (message.type === "participant-joined") {
      setParticipants((items) => upsertParticipant(items, message.participant));
      if (message.participant?.id) {
        voice.invite(message.participant.id).catch(() => {});
      }
      return;
    }

    if (message.type === "participant-updated") {
      setParticipants((items) => upsertParticipant(items, message.participant));
      return;
    }

    if (message.type === "self-updated" && message.self) {
      setRoom({
        ...(activeRoomRef.current || {}),
        selfId: message.self.id,
        host: message.self.role === "host",
        role: message.self.role
      });
      return;
    }

    if (message.type === "participant-left") {
      setParticipants((items) =>
        items.filter((item) => item.id !== message.participantId)
      );
      voice.removePeer(message.participantId);
      return;
    }

    if (message.type === "signal") {
      voice.accept(message.fromId, message.signal).catch(() => {});
      return;
    }

    if (message.type === "ui") {
      setRoomUi((current) => ({
        ...current,
        ...(message.state || {}),
        __eventId: createEventId("ui")
      }));
      return;
    }

    if (message.type === "sync") {
      const command = message.state || {};

      if (
        command.type === "song-request" &&
        activeRoomRef.current?.host &&
        command.requesterId &&
        command.songId
      ) {
        roomApi
          .exportSongPackage(command.songId)
          .then((blob) => {
            if (!isCurrentConnection()) return null;
            setVoiceError("Передаём песню участнику…");
            return voice.sendFile(command.requesterId, blob, {
              kind: "song-package",
              songId: command.songId,
              filename: `${command.songId}.karaoke.zip`
            });
          })
          .then(() => {
            if (isCurrentConnection()) setVoiceError("");
          })
          .catch((error) => {
            if (!isCurrentConnection()) return;
            setVoiceError(
              `Не удалось передать песню: ${getErrorMessage(error)}`
            );
          });
        return;
      }

      if (command.type === "open-karaoke" && !activeRoomRef.current?.host) {
        roomApi
          .getSong(command.songId)
          .then(() => {
            if (!isCurrentConnection()) return;
            setRoomCommand({
              ...command,
              __eventId: createEventId(message.sentAt || "sync")
            });
          })
          .catch(() => {
            if (!isCurrentConnection()) return;
            pendingCommandRef.current = command;
            setVoiceError("Получаем песню от ведущего…");
            client.send("sync", {
              state: {
                type: "song-request",
                songId: command.songId,
                requesterId: activeRoomRef.current?.selfId
              }
            });
          });
        return;
      }

      setRoomCommand({
        ...command,
        __eventId: createEventId(message.sentAt || "sync")
      });
      return;
    }

    if (message.type === "connection-closed" && !disconnectIntentRef.current) {
      setVoiceError("Соединение с комнатой потеряно.");
      cleanupConnection();
      setRoom(null);
      setParticipants([]);
    }
  };
}
