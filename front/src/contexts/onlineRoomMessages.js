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
    onParticipantLeft = () => {},
    onEffectControl = () => {},
    onConnectionClosed
  } = options;

  // serverSentAt (the worker's Date.now() when it relayed this command) lets
  // the receiver measure delivery latency and catch up its seek target --
  // useKaraokeTransport already reads __serverSentAt/__receivedServerAt for
  // exactly this, so every call site here must actually provide them.
  const publishRoomCommand = (command, eventPrefix, serverSentAt) => {
    const receivedServerAt = client.serverNow?.() ?? Date.now();
    setRoomCommand({
      ...command,
      __eventId: createEventId(eventPrefix),
      ...(Number.isFinite(serverSentAt)
        ? { __serverSentAt: serverSentAt, __receivedServerAt: receivedServerAt }
        : {})
    });
  };
  const senderIsHost = (message) =>
    participantsRef.current?.some(
      (participant) => participant.id === message.fromId && participant.role === "host"
    );
  const isCurrentPending = (command) =>
    isCurrentConnection() && pendingCommandRef.current?.commandId === command.commandId;

  const syncHandlers = {
    "karaoke-request": (command, message) => {
      if (
        !activeRoomRef.current?.host ||
        !command.requesterId ||
        message.fromId !== command.requesterId ||
        !command.songId ||
        !command.ownerId ||
        !command.revision
      )
        return false;
      const transferStatus = {
        participantId: "room",
        songId: command.songId,
        commandId: command.commandId,
        stage: "waiting",
        percent: 0
      };
      setTransferStatus(transferStatus);
      client.send("sync", { state: { type: "song-transfer-status", ...transferStatus } });
      publishRoomCommand(command, "karaoke-request", message.sentAt);
      return true;
    },
    "song-request": (command, message) => {
      const offered = hostSongCommandRef.current;
      if (
        !activeRoomRef.current?.host ||
        !command.requesterId ||
        !command.songId ||
        !command.commandId ||
        message.fromId !== command.requesterId ||
        offered?.commandId !== command.commandId ||
        offered.songId !== command.songId ||
        offered.revision !== command.revision
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
          if (!isCurrentConnection() || hostSongCommandRef.current?.commandId !== command.commandId)
            return null;
          setTransferStatus({
            participantId: command.requesterId,
            songId: command.songId,
            stage: "sending",
            percent: 0
          });
          return voice.sendFile(command.requesterId, blob, {
            resumable: true,
            kind: "song-package",
            songId: command.songId,
            commandId: command.commandId,
            revision: command.revision,
            filename: `${command.songId}.karaoke.zip`
          });
        })
        .then(() => {
          if (isCurrentConnection() && hostSongCommandRef.current?.commandId === command.commandId)
            setTransferStatus({
              participantId: command.requesterId,
              songId: command.songId,
              stage: "complete",
              percent: 100
            });
        })
        .catch((error) => {
          if (!isCurrentConnection() || hostSongCommandRef.current?.commandId !== command.commandId)
            return;
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
          setTransferStatus({
            participantId: command.requesterId,
            songId: command.songId,
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
        offered.songId !== command.songId ||
        offered.revision !== command.revision ||
        !offered.expectedIds?.has(command.requesterId)
      )
        return false;
      offered.markReady?.(command.requesterId);
      return true;
    },
    "song-transfer-status": (command, message) => {
      if (
        activeRoomRef.current?.host ||
        !senderIsHost(message) ||
        !command.songId ||
        !command.commandId ||
        !["waiting", "error", "complete"].includes(command.stage)
      )
        return false;
      setTransferStatus({
        participantId: "room",
        songId: command.songId,
        commandId: command.commandId,
        stage: command.stage,
        percent: Math.max(0, Math.min(100, Number(command.percent) || 0)),
        ...(command.error ? { error: command.error } : {})
      });
      return true;
    },
    "start-karaoke": (command, message) => {
      if (activeRoomRef.current?.host || !senderIsHost(message) || !isCurrentPending(command))
        return false;
      const localSongId = pendingCommandRef.current?.localSongId;
      pendingCommandRef.current = null;
      publishRoomCommand(
        localSongId ? { ...command, songId: localSongId } : command,
        "start",
        message.sentAt
      );
      return true;
    },
    "song-transfer-error": (command, message) => {
      if (
        !senderIsHost(message) ||
        command.requesterId !== activeRoomRef.current?.selfId ||
        !isCurrentPending(command)
      )
        return false;
      pendingCommandRef.current = null;
      setTransferStatus({
        participantId: message.fromId,
        songId: command.songId,
        stage: "error",
        error: command.error || translateSaved("room.theHostCouldNotSendTheSong"),
        percent: 0
      });
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
      const previous = pendingCommandRef.current;
      if (previous?.commandId && previous.commandId !== command.commandId) {
        voice.cancelTransfersByCommandId?.(previous.commandId);
        // A manual syncSong() call (Library's "open in karaoke" for a peer's
        // song) leaves its own promise on this ref. Cancelling the transfer
        // above unblocks the mesh, but that only settles the promise once a
        // "cancelled"/"error" progress event round-trips back here -- reject
        // it directly and immediately so the caller isn't left stranded.
        previous.reject?.(
          new Error(
            translateSaved("room.songSynchronizationRequestCancelledHostStartedAnotherSong")
          )
        );
      }
      pendingCommandRef.current = command;
      Promise.resolve()
        .then(async () => {
          let localSongId = command.songId;
          try {
            const local = await roomApi.getSongRevision(command.songId);
            if (local?.revision !== command.revision) throw new Error("Song revision differs");
          } catch {
            const match = await roomApi.resolveSongRevision(command.revision);
            if (!match?.song_id) throw new Error("Song is not available locally");
            localSongId = match.song_id;
          }
          if (!isCurrentPending(command)) return;
          pendingCommandRef.current = { ...command, localSongId };
          setTransferStatus({
            participantId: message.fromId,
            songId: command.songId,
            stage: "complete",
            percent: 100
          });
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
          setTransferStatus({
            participantId: message.fromId,
            songId: command.songId,
            stage: "waiting",
            percent: 0
          });
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
      if (message.sharedUi)
        setRoomUi((current) => ({
          ...current,
          ...message.sharedUi,
          __eventId: createEventId("snapshot")
        }));
      if (message.hostReconnectDeadline)
        setVoiceError(translateSaved("room.hostIsReconnectingRoomIsReservedFor45Seconds"));
      // Guests can operate playback while the host reconnects. A returning
      // host must follow the latest command too, not overwrite it with a heartbeat.
      if (message.playbackState && (self?.role !== "host" || message.resumed))
        publishRoomCommand(message.playbackState, "room-state", message.playbackSentAt);
      if (message.resumed && voice.peers) {
        const present = new Set(
          (message.participants || []).map(({ id: participantId }) => participantId)
        );
        for (const participantId of voice.peers.keys())
          if (!present.has(participantId)) voice.removePeer(participantId);
      }
    },
    "participant-joined": (message) => {
      const { participant } = message;
      setParticipants((items) => upsertParticipant(items, participant));
      if (!message.resumed && participant?.id && participant.id !== activeRoomRef.current?.selfId)
        onParticipantJoined(participant);
      if (participant?.id && (!message.resumed || !voice.peers?.has(participant.id)))
        voice.invite(participant.id).catch((error) => setVoiceError(getErrorMessage(error)));
    },
    "participant-updated": (message) =>
      setParticipants((items) => upsertParticipant(items, message.participant)),
    "effect-control": (message) => onEffectControl(message.effects, message.fromId),
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
      if (message.participantId && message.participantId !== activeRoomRef.current?.selfId)
        onParticipantLeft(message.participantId);
      const offered = hostSongCommandRef.current;
      if (activeRoomRef.current?.host && offered?.expectedIds?.has(message.participantId)) {
        offered.expectedIds.delete(message.participantId);
        offered.markReady?.(message.participantId);
      }
      voice.removePeer(message.participantId);
    },
    signal: (message) =>
      voice
        .accept(message.fromId, message.signal)
        .catch((error) => setVoiceError(getErrorMessage(error))),
    ui: (message) => {
      const state = message.state || {};
      const { participantEffects, songs } = state;
      if (
        !participantsRef.current?.some(({ id: participantId }) => participantId === message.fromId)
      )
        return;
      const shared = Object.fromEntries(
        ["query", "filters", "libraryFiltersOpen", "radio", "karaoke"]
          .filter((key) => Object.hasOwn(state, key))
          .map((key) => [key, state[key]])
      );
      setRoomUi((current) => ({
        ...current,
        ...shared,
        ...(message.fromId && participantEffects
          ? {
              effectsByParticipant: {
                ...(current.effectsByParticipant || {}),
                [message.fromId]: participantEffects
              }
            }
          : {}),
        // Every participant (host or guest) owns a library, so a guest's own
        // songs arrive here tagged by sender instead of replacing shared state.
        ...(message.fromId && songs
          ? {
              songsByParticipant: {
                ...(current.songsByParticipant || {}),
                [message.fromId]: songs
              }
            }
          : {}),
        __eventId: createEventId("ui")
      }));
    },
    error: (message) =>
      setVoiceError(message.message || translateSaved("room.roomServerRejectedTheAction")),
    "effect-control-denied": () =>
      setVoiceError(translateSaved("room.participantDoesNotAllowChangesToTheirEffects")),
    "connection-reconnecting": () => {
      setVoiceError(
        translateSaved("room.serverConnectionLostReconnectingWithoutInterruptingVoice")
      );
    },
    "connection-restored": () => {
      setVoiceError("");
      // Only the reconnecting client initiates recovery. Healthy P2P paths
      // keep running; failed/missing ones are negotiated again.
      for (const participant of participantsRef.current || []) {
        if (participant.id === activeRoomRef.current?.selfId || participant.reconnecting) continue;
        const peer = voice.peers?.get(participant.id);
        if (peer && (!peer.connectionState || peer.connectionState === "connected")) continue;
        if (peer) voice.removePeer(participant.id);
        voice.invite(participant.id).catch((error) => setVoiceError(getErrorMessage(error)));
      }
    },
    "host-reconnecting": (message) => {
      setParticipants((items) =>
        items.map((item) =>
          item.id === message.participantId ? { ...item, reconnecting: true } : item
        )
      );
      setVoiceError(translateSaved("room.hostIsReconnectingRoomIsReservedFor45Seconds"));
    },
    "host-reconnected": (message) => {
      setParticipants((items) =>
        upsertParticipant(items, { ...message.participant, reconnecting: false })
      );
      setVoiceError("");
    },
    sync: (message) => {
      const command = message.state || {};
      if (Object.hasOwn(syncHandlers, command.type)) {
        syncHandlers[command.type](command, message);
        return;
      }
      // The server admits karaoke-player commands only from an actual room
      // participant and validates their fields. This deliberately lets a
      // guest use the shared transport instead of playing locally and then
      // being snapped back by the host's next heartbeat.
      const sharedLibraryReturn =
        command.type === "open-library" &&
        participantsRef.current.some((participant) => participant.id === message.fromId);
      if (!senderIsHost(message) && command.type !== "karaoke-player" && !sharedLibraryReturn)
        return;
      publishRoomCommand(command, "sync", message.sentAt);
    },
    "connection-closed": () => {
      if (disconnectIntentRef.current) return;
      if (onConnectionClosed) return onConnectionClosed();
      cleanupConnection();
      setRoom(null);
      setParticipants([]);
      setVoiceError(translateSaved("room.theConnectionToTheRoomIsLost"));
    },
    "room-closed": (message) => {
      if (disconnectIntentRef.current) return;
      // The host leaving closes the whole room server-side (see
      // KaraokeRoom.webSocketClose) -- this message arrives just ahead of
      // the socket's own close frame, so guests get the real reason instead
      // of the generic "connection lost" message the plain socket close
      // would otherwise report.
      const reason =
        message.reason === "host-left"
          ? translateSaved("room.hostLeftTheRoomRoomClosed")
          : message.reason === "host-timeout"
            ? translateSaved("room.hostDidNotReconnectWithin45SecondsRoomClosed")
            : translateSaved("room.roomClosed2");
      if (onConnectionClosed) return onConnectionClosed(reason);
      cleanupConnection();
      setRoom(null);
      setParticipants([]);
      setVoiceError(reason);
    }
  };

  return (message) => {
    if (!isCurrentConnection()) return;
    if (Object.hasOwn(messageHandlers, message.type)) messageHandlers[message.type](message);
  };
}
