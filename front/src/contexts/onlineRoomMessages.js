import { translateSaved } from "../i18n/runtime";
// Node's direct ESM tests require explicit extensions for these source imports.
// eslint-disable-next-line import/extensions
import { normalizeRoomId } from "../services/onlineRoom.js";
// eslint-disable-next-line import/extensions
import { getErrorMessage } from "../utils/errors.js";

function createEventId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random()}`;
}
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
    participantsRef = { current: [] },
    intentionalDisconnectRef: disconnectIntentRef,
    pendingSongCommandRef: pendingCommandRef,
    cleanupConnection,
    setRoom,
    setParticipants,
    setRoomUi,
    setRoomCommand,
    setVoiceError,
    setTransferStatus,
    onParticipantJoined = () => {},
    onConnectionClosed
  } = options;

  const publishRoomCommand = (command, eventPrefix) => {
    setRoomCommand({ ...command, __eventId: createEventId(eventPrefix) });
  };
  const senderIsHost = (message) =>
    participantsRef.current?.some((participant) => participant.id === message.fromId && participant.role === "host");

  const syncHandlers = {
    "song-request": (command, message) => {
      if (
        !activeRoomRef.current?.host ||
        !command.requesterId ||
        !command.songId ||
        (!message.fromId || message.fromId !== command.requesterId)
      ) {
        return false;
      }
      roomApi
        .exportSongPackage(command.songId)
        .then((blob) => {
          if (!isCurrentConnection()) return null;
          setTransferStatus({ stage: "sending", percent: 0 });
          return voice
            .sendFile(command.requesterId, blob, {
              kind: "song-package",
              songId: command.songId,
              filename: `${command.songId}.karaoke.zip`
            })
            .finally(() => blob.cleanup?.());
        })
        .then(() => { if (isCurrentConnection()) setTransferStatus(null); })
        .catch((error) => {
          if (!isCurrentConnection()) return;
          const message = getErrorMessage(error);
          client.send("sync", {
            state: {
              type: "song-transfer-error",
              requesterId: command.requesterId,
              songId: command.songId,
              error: message
            }
          });
          setTransferStatus({ stage: "error", error: message, percent: 0 });
        });
      return true;
    },
    "song-transfer-error": (command, message) => {
      if (!senderIsHost(message) || command.requesterId !== activeRoomRef.current?.selfId) return false;
      pendingCommandRef.current = null;
      setTransferStatus({
        stage: "error",
        error: command.error || translateSaved("Ведущий не смог передать песню"),
        percent: 0
      });
      return true;
    },
    "open-karaoke": (command, message) => {
      if (activeRoomRef.current?.host || !senderIsHost(message)) return false;
      roomApi
        .getSong(command.songId)
        .then(() => {
          if (!isCurrentConnection()) return;
          publishRoomCommand(command, message.sentAt || "sync");
        })
        .catch(() => {
          if (!isCurrentConnection()) return;
          pendingCommandRef.current = command;
          setTransferStatus({ stage: "waiting", percent: 0 });
          client.send("sync", {
            state: {
              type: "song-request",
              songId: command.songId,
              requesterId: activeRoomRef.current?.selfId
            }
          });
        });
      return true;
    }
  };

  const messageHandlers = {
    "room-state": (message) => {
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
    },
    "participant-joined": (message) => {
      const { participant } = message;
      setParticipants((items) => upsertParticipant(items, participant));
      if (participant?.id !== activeRoomRef.current?.selfId) onParticipantJoined(participant);
      if (participant?.id) voice.invite(participant.id).catch(() => {});
    },
    "participant-updated": (message) => {
      setParticipants((items) => upsertParticipant(items, message.participant));
    },
    "self-updated": (message) => {
      if (!message.self) return;
      setRoom({
        ...(activeRoomRef.current || {}),
        selfId: message.self.id,
        host: message.self.role === "host",
        role: message.self.role
      });
    },
    "participant-left": (message) => {
      setParticipants((items) => items.filter((item) => item.id !== message.participantId)
      );
      voice.removePeer(message.participantId);
    },
    signal: (message) => {
      voice.accept(message.fromId, message.signal).catch(() => {});
    },
    ui: (message) => {
      const state = message.state || {};
      const { participantEffects } = state;
      const host = senderIsHost(message);
      if (!host && !participantEffects) return;
      setRoomUi((current) => ({
        ...current,
        ...(host ? state : {}),
        ...(message.fromId && participantEffects ? {
          effectsByParticipant: { ...(current.effectsByParticipant || {}), [message.fromId]: participantEffects }
        } : {}),
        __eventId: createEventId("ui")
      }));
    },
    sync: (message) => {
      const command = message.state || {};
      if (Object.hasOwn(syncHandlers, command.type) && syncHandlers[command.type](command, message)) return;
      if (!senderIsHost(message)) return;
      publishRoomCommand(command, message.sentAt || "sync");
    },
    "connection-closed": () => {
      if (disconnectIntentRef.current) return;
      if (onConnectionClosed) {
        onConnectionClosed();
        return;
      }
      cleanupConnection();
      setRoom(null);
      setParticipants([]);
      setVoiceError(translateSaved("Соединение с комнатой потеряно."));
    }
  };

  return (message) => {
    if (!isCurrentConnection()) return;
    if (Object.hasOwn(messageHandlers, message.type)) messageHandlers[message.type](message);
  };
}
