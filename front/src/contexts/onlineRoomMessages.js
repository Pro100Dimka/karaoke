import { translateSaved } from "../i18n/runtime";
// Node's direct ESM tests require explicit extensions for these source imports.
// eslint-disable-next-line import/extensions
import { normalizeRoomId } from "../services/onlineRoom";
// eslint-disable-next-line import/extensions
import { getErrorMessage } from "../utils/errors";

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
    onConnectionClosed,
    lastRoomErrorRef = { current: null }
  } = options;

  const publishRoomCommand = (command, eventPrefix) => {
    setRoomCommand({
      ...command,
      __serverSentAt: Number(eventPrefix) || null,
      __receivedServerAt: client.serverNow?.() ?? Date.now(),
      __eventId: createEventId(eventPrefix)
    });
  };
  const senderIsHost = (message) =>
    participantsRef.current?.some(
      (participant) => participant.id === message.fromId && participant.role === "host"
    );
  const senderIsParticipant = (message) =>
    participantsRef.current?.some((participant) => participant.id === message.fromId);
  const guestSharedUi = (state) =>
    Object.fromEntries(
      Object.entries(state).filter(([key]) => ["query", "filters", "radio", "karaoke"].includes(key))
    );
  const guestSharedCommand = (command) =>
    ["karaoke-player", "open-library"].includes(command?.type);
  const isCurrentPending = (command) =>
    isCurrentConnection() && pendingCommandRef.current?.commandId === command.commandId;

  const syncHandlers = {
    "song-request": (command, message) => {
      const offered = hostSongCommandRef.current;
      const manualTransfer = Boolean(command.ownerId);
      const ownsManualSong = manualTransfer && command.ownerId === activeRoomRef.current?.selfId;
      const ownsHostOffer =
        activeRoomRef.current?.host &&
        offered?.commandId === command.commandId &&
        offered?.songId === command.songId &&
        offered?.revision === command.revision;
      if (
        !command.requesterId ||
        !command.songId ||
        !command.commandId ||
        !command.revision ||
        message.fromId !== command.requesterId ||
        (!ownsManualSong && !ownsHostOffer)
      )
        return false;

      let exportEntry = songExportsRef.current.get(command.commandId);
      if (!exportEntry) {
        exportEntry = {
          promise: roomApi.exportSongPackage(command.songId, command.revision),
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
          if (
            !isCurrentConnection() ||
            (!manualTransfer && hostSongCommandRef.current?.commandId !== command.commandId)
          )
            return null;
          setTransferStatus({
            participantId: command.requesterId,
            songId: command.songId,
            commandId: command.commandId,
            stage: "sending",
            percent: 0
          });
          return voice.sendFile(command.requesterId, blob, {
            kind: "song-package",
            songId: command.songId,
            commandId: command.commandId,
            revision: command.revision,
            filename: `${command.songId}.karaoke.zip`
          });
        })
        .then(() => {
          if (
            isCurrentConnection() &&
            (manualTransfer || hostSongCommandRef.current?.commandId === command.commandId)
          )
            setTransferStatus({
              participantId: command.requesterId,
              songId: command.songId,
              commandId: command.commandId,
              stage: "complete",
              percent: 100
            });
        })
        .catch((error) => {
          if (
            !isCurrentConnection() ||
            (!manualTransfer && hostSongCommandRef.current?.commandId !== command.commandId)
          )
            return;
          const errorText = getErrorMessage(error);
          client.send("sync", {
            state: {
              type: "song-transfer-error",
              requesterId: command.requesterId,
              ownerId: command.ownerId,
              songId: command.songId,
              commandId: command.commandId,
              error: errorText
            }
          });
          setTransferStatus({
            participantId: command.requesterId,
            stage: "error",
            error: errorText,
            percent: 0
          });
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
    "song-ready": (command, message) => {
      const offered = hostSongCommandRef.current;
      if (
        !activeRoomRef.current?.host ||
        !command.requesterId ||
        message.fromId !== command.requesterId ||
        offered?.commandId !== command.commandId ||
        offered?.songId !== command.songId ||
        offered?.revision !== command.revision ||
        !offered?.expectedIds?.has(command.requesterId)
      )
        return false;
      offered.markReady?.(command.requesterId);
      return true;
    },
    "start-karaoke": (command, message) => {
      if (activeRoomRef.current?.host || !senderIsHost(message) || !isCurrentPending(command))
        return false;
      pendingCommandRef.current = null;
      publishRoomCommand(command, message.sentAt || "start");
      return true;
    },
    "song-transfer-error": (command, message) => {
      const pending = pendingCommandRef.current;
      const validSender = pending?.ownerId
        ? message.fromId === pending.ownerId
        : senderIsHost(message);
      if (
        !validSender ||
        command.requesterId !== activeRoomRef.current?.selfId ||
        !isCurrentPending(command)
      )
        return false;
      pendingCommandRef.current = null;
      const errorText = command.error || translateSaved("Не удалось передать песню");
      setTransferStatus({
        participantId: message.fromId,
        stage: "error",
        error: errorText,
        percent: 0
      });
      pending?.reject?.(new Error(errorText));
      return true;
    },
    "open-karaoke": (command, message) => {
      if (
        activeRoomRef.current?.host ||
        !senderIsHost(message) ||
        !command.songId ||
        !command.commandId ||
        !command.revision
      )
        return false;
      const previousPending = pendingCommandRef.current;
      if (previousPending?.commandId && previousPending.commandId !== command.commandId) {
        voice.cancelTransfersByCommandId?.(previousPending.commandId);
        // A manual syncSong() request (pendingCommandRef holds its resolve/reject) must not
        // be left hanging: without this it never settles until its own 5-minute timeout,
        // because that timer only fires for the commandId it was created for, and by then
        // pendingCommandRef.current already points at this new open-karaoke command.
        previousPending.reject?.(
          new Error(translateSaved("Передача песни заменена новым запросом от ведущего"))
        );
      }
      pendingCommandRef.current = command;
      roomApi
        .getSongRevision(command.songId)
        .then((local) => {
          if (!isCurrentPending(command)) return;
          if (local?.revision !== command.revision) throw new Error("Song revision differs");
          setTransferStatus({ participantId: message.fromId, stage: "complete", percent: 100 });
          client.send("sync", {
            state: {
              type: "song-ready",
              commandId: command.commandId,
              songId: command.songId,
              revision: command.revision,
              requesterId: activeRoomRef.current?.selfId
            }
          });
        })
        .catch(() => {
          if (!isCurrentPending(command)) return;
          setTransferStatus({ participantId: message.fromId, stage: "waiting", percent: 0 });
          client.send("sync", {
            state: {
              type: "song-request",
              commandId: command.commandId,
              songId: command.songId,
              revision: command.revision,
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
      if (self)
        setRoom({
          id: normalizeRoomId(id),
          selfId: self.id,
          host: self.role === "host",
          role: self.role
        });
      setParticipants(message.participants || []);
    },
    "participant-joined": (message) => {
      const { participant } = message;
      setParticipants((items) => upsertParticipant(items, participant));
      if (participant?.id !== activeRoomRef.current?.selfId) onParticipantJoined(participant);
      if (participant?.id) voice.invite(participant.id).catch(() => {});
    },
    "participant-updated": (message) =>
      setParticipants((items) => upsertParticipant(items, message.participant)),
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
      setRoomUi((current) => {
        if (!current.songsByParticipant?.[message.participantId]) return current;
        const songsByParticipant = { ...current.songsByParticipant };
        delete songsByParticipant[message.participantId];
        return { ...current, songsByParticipant, __eventId: createEventId("ui") };
      });
      const offered = hostSongCommandRef.current;
      if (activeRoomRef.current?.host && offered?.expectedIds?.has(message.participantId)) {
        offered.expectedIds.delete(message.participantId);
        offered.markReady?.(message.participantId);
      }
      voice.removePeer(message.participantId);
    },
    signal: (message) => voice.accept(message.fromId, message.signal).catch(() => {}),
    ui: (message) => {
      if (!senderIsParticipant(message)) return;
      const state = message.state || {};
      const { participantEffects, participantSongs } = state;
      const host = senderIsHost(message);
      const shared = guestSharedUi(state);
      if (!host && !participantEffects && !participantSongs && !Object.keys(shared).length) return;
      setRoomUi((current) => ({
        ...current,
        ...(host
          ? Object.fromEntries(Object.entries(state).filter(([key]) => key !== "participantSongs"))
          : shared),
        ...(message.fromId && participantEffects
          ? {
              effectsByParticipant: {
                ...(current.effectsByParticipant || {}),
                [message.fromId]: participantEffects
              }
            }
          : {}),
        ...(message.fromId && Array.isArray(participantSongs)
          ? {
              songsByParticipant: {
                ...(current.songsByParticipant || {}),
                [message.fromId]: participantSongs.map((song) => ({
                  ...song,
                  __roomOwnerId: message.fromId
                }))
              }
            }
          : {}),
        __eventId: createEventId("ui")
      }));
    },
    sync: (message) => {
      const command = message.state || {};
      if (Object.hasOwn(syncHandlers, command.type)) {
        syncHandlers[command.type](command, message);
        return;
      }
      if (!senderIsHost(message) && !(senderIsParticipant(message) && guestSharedCommand(command)))
        return;
      publishRoomCommand(command, message.sentAt || "sync");
    },
    // Sent by the server right before it force-closes this socket (rate limit, oversized or
    // invalid payload, etc.). Recorded so "connection-closed" can surface the real reason
    // instead of a generic "connection lost" message.
    error: (message) => {
      const text = typeof message.message === "string" ? message.message.trim() : "";
      if (text) lastRoomErrorRef.current = text;
    },
    "connection-closed": () => {
      const reason = lastRoomErrorRef.current;
      lastRoomErrorRef.current = null;
      if (disconnectIntentRef.current) return;
      if (onConnectionClosed) return onConnectionClosed(reason);
      cleanupConnection();
      setRoom(null);
      setParticipants([]);
      setVoiceError(reason || translateSaved("Соединение с комнатой потеряно."));
    }
  };

  return (message) => {
    if (!isCurrentConnection()) return;
    if (Object.hasOwn(messageHandlers, message.type)) messageHandlers[message.type](message);
  };
}
