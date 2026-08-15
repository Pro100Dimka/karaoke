import { translateSaved } from "../i18n/runtime.js";
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
    hostSongCommandRef = { current: null },
    songExportsRef = { current: new Map() },
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
  const isCurrentPending = (command) =>
    isCurrentConnection() && pendingCommandRef.current?.commandId === command.commandId;

  const syncHandlers = {
    "song-request": (command, message) => {
      const offered = hostSongCommandRef.current;
      if (
        !activeRoomRef.current?.host ||
        !command.requesterId ||
        !command.songId ||
        !command.commandId ||
        message.fromId !== command.requesterId ||
        offered?.commandId !== command.commandId ||
        offered.songId !== command.songId
      ) return false;

      let exportEntry = songExportsRef.current.get(command.commandId);
      if (!exportEntry) {
        exportEntry = {
          promise: roomApi.exportSongPackage(command.songId),
          requesters: new Set(),
          users: 0
        };
        songExportsRef.current.set(command.commandId, exportEntry);
      }
      if (exportEntry.requesters.has(command.requesterId)) return true;
      exportEntry.requesters.add(command.requesterId);
      exportEntry.users += 1;
      exportEntry.promise
        .then(async (blob) => {
          if (!isCurrentConnection() || hostSongCommandRef.current?.commandId !== command.commandId) return null;
          setTransferStatus({ participantId: command.requesterId, stage: "sending", percent: 0 });
          return voice.sendFile(command.requesterId, blob, {
            kind: "song-package",
            songId: command.songId,
            commandId: command.commandId,
            filename: `${command.songId}.karaoke.zip`
          });
        })
        .then(() => {
          if (isCurrentConnection() && hostSongCommandRef.current?.commandId === command.commandId)
            setTransferStatus({ participantId: command.requesterId, stage: "complete", percent: 100 });
        })
        .catch((error) => {
          if (!isCurrentConnection() || hostSongCommandRef.current?.commandId !== command.commandId) return;
          const errorText = getErrorMessage(error);
          client.send("sync", {
            state: {
              type: "song-transfer-error",
              requesterId: command.requesterId,
              songId: command.songId,
              commandId: command.commandId,
              error: errorText
            }
          });
          setTransferStatus({ participantId: command.requesterId, stage: "error", error: errorText, percent: 0 });
        })
        .finally(async () => {
          exportEntry.requesters.delete(command.requesterId);
          exportEntry.users -= 1;
          if (exportEntry.users) return;
          songExportsRef.current.delete(command.commandId);
          const blob = await exportEntry.promise.catch(() => null);
          await blob?.cleanup?.();
        });
      return true;
    },
    "song-transfer-error": (command, message) => {
      if (
        !senderIsHost(message) ||
        command.requesterId !== activeRoomRef.current?.selfId ||
        !isCurrentPending(command)
      ) return false;
      pendingCommandRef.current = null;
      setTransferStatus({
        participantId: message.fromId,
        stage: "error",
        error: command.error || translateSaved("Ведущий не смог передать песню"),
        percent: 0
      });
      return true;
    },
    "open-karaoke": (command, message) => {
      if (activeRoomRef.current?.host || !senderIsHost(message) || !command.songId || !command.commandId) return false;
      pendingCommandRef.current = command;
      roomApi.getSong(command.songId)
        .then(() => {
          if (!isCurrentPending(command)) return;
          pendingCommandRef.current = null;
          setTransferStatus({ participantId: message.fromId, stage: "complete", percent: 100 });
          publishRoomCommand(command, message.sentAt || "sync");
        })
        .catch(() => {
          if (!isCurrentPending(command)) return;
          setTransferStatus({ participantId: message.fromId, stage: "waiting", percent: 0 });
          client.send("sync", {
            state: {
              type: "song-request",
              commandId: command.commandId,
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
      if (self) setRoom({ id: normalizeRoomId(id), selfId: self.id, host: self.role === "host", role: self.role });
      setParticipants(message.participants || []);
    },
    "participant-joined": (message) => {
      const { participant } = message;
      setParticipants((items) => upsertParticipant(items, participant));
      if (participant?.id !== activeRoomRef.current?.selfId) onParticipantJoined(participant);
      if (participant?.id) voice.invite(participant.id).catch(() => {});
    },
    "participant-updated": (message) => setParticipants((items) => upsertParticipant(items, message.participant)),
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
      setParticipants((items) => items.filter((item) => item.id !== message.participantId));
      voice.removePeer(message.participantId);
    },
    signal: (message) => voice.accept(message.fromId, message.signal).catch(() => {}),
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
      if (Object.hasOwn(syncHandlers, command.type)) {
        syncHandlers[command.type](command, message);
        return;
      }
      if (!senderIsHost(message)) return;
      publishRoomCommand(command, message.sentAt || "sync");
    },
    "connection-closed": () => {
      if (disconnectIntentRef.current) return;
      if (onConnectionClosed) return onConnectionClosed();
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
