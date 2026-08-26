import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { api } from "../api/client";
import { translateSaved } from "../i18n/runtime";
import {
  createHostToken,
  createRoomId,
  OnlineRoomClient,
  OnlineVoiceMesh
} from "../services/onlineRoom";
import { getErrorMessage } from "../utils/errors";
import useApplicationAudioMute from "./hooks/useApplicationAudioMute";
import useOnlineRoomAudio from "./hooks/useOnlineRoomAudio";
import useOnlineRoomCommands from "./hooks/useOnlineRoomCommands";
import useOnlineRoomValue from "./hooks/useOnlineRoomValue";
import useSpeakingLevels from "./hooks/useSpeakingLevels";
import { createCommandId } from "./onlineRoomActions";
import { playParticipantJoinedSound } from "./onlineRoomAudio";
import { createOnlineRoomMessageHandler } from "./onlineRoomMessages";

const OnlineRoomContext = createContext(null);
// Speaking levels update on a ~70ms meter tick while anyone's mic is live,
// which is far more often than the rest of the room state changes. Keeping
// them out of the main context value means a room-wide voice call doesn't
// re-render every consumer of useOnlineRoom() (Karaoke, Library, OnlineRoom
// pages, navigation hooks) dozens of times a second -- only the one place
// that actually renders speaking indicators (OnlineRoomDock) subscribes to
// this context and re-renders on those ticks.
const OnlineRoomSpeakingContext = createContext({ localSpeakingLevel: 0, speakingLevels: {} });
const OFF = false;
const SONG_SYNC_REQUEST_TIMEOUT_MS = 15_000;
export function OnlineRoomProvider({ children }) {
  const clientRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const voiceRef = useRef(null);
  const roomUiRef = useRef({});
  const microphoneMutedRef = useRef(OFF);
  const roomRef = useRef(null);
  const mutedPeopleRef = useRef(new Set());
  const roomSoundMutedRef = useRef(OFF);
  const participantVolumesRef = useRef({});
  const intentionalDisconnectRef = useRef(OFF);
  const pendingSongCommandRef = useRef(null);
  const hostSongCommandRef = useRef(null);
  const songExportsRef = useRef(new Map());
  // Ad-hoc "sync this song from a participant's library" request, separate
  // from pendingSongCommandRef (which only tracks the host-driven "start
  // karaoke" push). One sync in flight at a time, same as song processing.
  const librarySyncRef = useRef(null);
  const connectionTokenRef = useRef(null);
  const [room, setRoomState] = useState(null);
  const participantsRef = useRef([]);
  const [participants, setParticipantsState] = useState([]);
  const setParticipants = useCallback((next) => {
    setParticipantsState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      participantsRef.current = value;
      return value;
    });
  }, []);
  const [mutedPeople, setMutedPeople] = useState(() => new Set());
  const [effectPeople, setEffectPeople] = useState(() => new Set());
  const [participantVolumes, setParticipantVolumes] = useState({});
  const [microphoneMuted, setMicrophoneMutedState] = useState(OFF);
  const [roomSoundMuted, setRoomSoundMutedState] = useState(OFF);
  const [roomUi, setRoomUi] = useState({});
  const [roomCommand, setRoomCommand] = useState(null);
  const [voiceError, setVoiceError] = useState("");
  const [transferStatuses, setTransferStatuses] = useState(() => new Map());
  const setTransferStatus = useCallback((status) => {
    setTransferStatuses((current) => {
      if (!status) return new Map();
      const next = new Map(current);
      const key = status.participantId || "room";
      if (["complete", "clear"].includes(status.stage)) next.delete(key);
      else next.set(key, status);
      return next;
    });
  }, []);
  const activeTransfer =
    [...transferStatuses.values()].find((item) => item.stage === "error") ||
    [...transferStatuses.values()].at(-1) ||
    null;
  const transferStatus = activeTransfer
    ? Object.fromEntries(
        Object.entries(activeTransfer).filter(
          ([key]) => !["participantId", "commandId"].includes(key)
        )
      )
    : null;
  const { muteApplicationAudio, restoreApplicationAudio } = useApplicationAudioMute(roomSoundMuted);
  const {
    localSpeakingLevel,
    speakingLevels,
    startSpeakingMeter,
    stopSpeakingMeter,
    stopAllSpeakingMeters
  } = useSpeakingLevels();
  const setRoom = useCallback(
    (next) => {
      roomRef.current = next;
      setRoomState(next);
    },
    // Stryker disable next-line ArrayDeclaration: React setters and refs are stable.
    []
  );
  const {
    applyParticipantEffects,
    applyRemoteAudioMute,
    attachRemoteStream,
    removeAllRemoteAudio,
    removeRemoteAudio,
    setParticipantVolume: applyParticipantVolume,
    setLocalMonitoring,
    stopLocalMonitoring
  } = useOnlineRoomAudio({
    mutedPeopleRef,
    roomSoundMutedRef,
    roomUiRef,
    participantVolumesRef,
    startSpeakingMeter,
    stopSpeakingMeter,
    voiceRef
  });
  const cleanupConnection = useCallback(
    () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      stopLocalMonitoring();
      voiceRef.current?.stop();
      stopAllSpeakingMeters();
      voiceRef.current = null;
      removeAllRemoteAudio();
      clientRef.current?.disconnect();
      clientRef.current = null;
    },
    // Stryker disable next-line ArrayDeclaration: both callbacks are stable.
    [removeAllRemoteAudio, stopAllSpeakingMeters, stopLocalMonitoring]
  );
  const setMicrophoneMuted = useCallback(
    (muted, broadcast = true) => {
      const next = Boolean(muted);
      voiceRef.current?.setMicrophoneMuted(next);
      microphoneMutedRef.current = next;
      setMicrophoneMutedState(next);
      if (broadcast) clientRef.current?.send("presence", { micMuted: next });
    },
    // Refs and React setters are stable.
    // Stryker disable next-line ArrayDeclaration
    []
  );
  const requestMicrophoneAccess = useCallback(
    async () => {
      const voice = voiceRef.current;
      if (!voice) {
        setVoiceError(translateSaved("Сначала подключитесь к комнате."));
        return false;
      }
      setVoiceError("");
      setTransferStatus(null);
      try {
        const stream = await voice.start();
        if (voiceRef.current !== voice) {
          stream.getTracks().forEach((track) => track.stop());
          return false;
        }
        startSpeakingMeter("local", stream);
        const muted = microphoneMutedRef.current;
        voice.setMicrophoneMuted(muted);
        clientRef.current.send("presence", { micMuted: muted });
        return true;
      } catch (error) {
        if (voiceRef.current !== voice) return false;
        const message = getErrorMessage(error, translateSaved("нет доступа к микрофону"));
        setVoiceError(
          translateSaved(
            "Не удалось получить доступ к микрофону: {0}. Проверьте разрешение Windows и повторите попытку.",
            { 0: message }
          )
        );
        return false;
      }
    },
    // Stryker disable next-line ArrayDeclaration: startSpeakingMeter is stable.
    [setTransferStatus, startSpeakingMeter]
  );
  const requestSongSync = useCallback(
    (songId, ownerId) => {
      const voice = voiceRef.current;
      const selfId = roomRef.current?.selfId;
      if (!voice || !songId || !ownerId || ownerId === selfId || librarySyncRef.current)
        return Promise.resolve(false);
      const commandId = createCommandId();
      return new Promise((resolve) => {
        const pending = { commandId, songId, ownerId };
        const finish = (result, error) => {
          globalThis.clearTimeout(pending.timer);
          if (librarySyncRef.current === pending) librarySyncRef.current = null;
          if (error) {
            setTransferStatus({
              participantId: ownerId,
              commandId,
              stage: "error",
              error: getErrorMessage(error),
              percent: 0
            });
          }
          resolve(result);
        };
        pending.resolve = () => finish(true);
        pending.reject = (error) => finish(false, error);
        librarySyncRef.current = pending;
        pending.timer = globalThis.setTimeout(
          () => pending.reject(new Error(translateSaved("Участник не ответил на запрос песни"))),
          SONG_SYNC_REQUEST_TIMEOUT_MS
        );
        setTransferStatus({ participantId: ownerId, commandId, stage: "waiting", percent: 0 });
        voice
          .waitForDataChannel(ownerId, SONG_SYNC_REQUEST_TIMEOUT_MS, voice.lifecycleVersion)
          .then((channel) => {
            if (librarySyncRef.current === pending)
              channel.send(JSON.stringify({ type: "song-sync-request", commandId, songId }));
          })
          .catch((error) => {
            if (librarySyncRef.current === pending) pending.reject(error);
          });
      });
    },
    // Stryker disable next-line ArrayDeclaration: setTransferStatus is stable.
    [setTransferStatus]
  );
  const setRoomSoundMuted = useCallback(
    (muted) => {
      const next = Boolean(muted);
      if (next === roomSoundMutedRef.current) return;
      roomSoundMutedRef.current = next;
      setRoomSoundMutedState(next);
      if (next) muteApplicationAudio(document);
      else restoreApplicationAudio();
      // Room-output mute is local playback state only. Never disable the
      // outgoing microphone track: otherwise every participant loses this
      // user's voice and unmuting can race with WebRTC track state.
      applyRemoteAudioMute();
    },
    // Stryker disable next-line ArrayDeclaration: all callback dependencies are stable.
    [applyRemoteAudioMute, muteApplicationAudio, restoreApplicationAudio]
  );
  const resetRoomState = useCallback(
    () => {
      setRoom(null);
      setParticipants([]);
      mutedPeopleRef.current = new Set();
      setMutedPeople(new Set());
      setEffectPeople(new Set());
      participantVolumesRef.current = {};
      setParticipantVolumes({});
      roomSoundMutedRef.current = OFF;
      setRoomSoundMutedState(OFF);
      microphoneMutedRef.current = OFF;
      setMicrophoneMutedState(OFF);
      setRoomUi({});
      setRoomCommand(null);
      pendingSongCommandRef.current = null;
      hostSongCommandRef.current = null;
      songExportsRef.current.clear();
      librarySyncRef.current?.reject?.(new Error(translateSaved("Комната закрыта")));
      librarySyncRef.current = null;
      setTransferStatus(null);
      setVoiceError("");
    },
    // Stryker disable next-line ArrayDeclaration: setRoom is stable.
    [setParticipants, setRoom, setTransferStatus]
  );
  const leaveRoom = useCallback(
    () => {
      connectionTokenRef.current = Symbol("left-room");
      intentionalDisconnectRef.current = true;
      restoreApplicationAudio();
      cleanupConnection();
      resetRoomState();
      intentionalDisconnectRef.current = OFF;
    },
    // Stryker disable next-line ArrayDeclaration: all callback dependencies are stable.
    [cleanupConnection, resetRoomState, restoreApplicationAudio]
  );
  const connect = useCallback(
    async ({ id, name, host, hostToken }) => {
      const connectionToken = Symbol("room-connection");
      connectionTokenRef.current = connectionToken;
      intentionalDisconnectRef.current = true;
      restoreApplicationAudio();
      cleanupConnection();
      intentionalDisconnectRef.current = OFF;
      resetRoomState();
      const client = new OnlineRoomClient();
      const voice = new OnlineVoiceMesh(client);
      clientRef.current = client;
      voiceRef.current = voice;
      const isCurrentConnection = () => connectionToken === connectionTokenRef.current;
      voice.onRemoteStream = (participantId, stream) => {
        if (!isCurrentConnection()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        attachRemoteStream(participantId, stream, () => {
          if (!isCurrentConnection()) return;
          setVoiceError(
            translateSaved("Нажмите в любом месте приложения, чтобы разрешить звук комнаты.")
          );
        });
      };
      voice.onPeerClosed = (participantId) => {
        if (isCurrentConnection()) removeRemoteAudio(participantId);
      };
      voice.onTransferProgress = ({ participantId, stage, percent, metadata }) => {
        if (!isCurrentConnection()) return;
        const commandId = metadata?.commandId;
        // A library sync has no host/pending-command correlation to check --
        // it's a direct request between two participants -- so its sends are
        // always shown (this is also how the sender sees a recipient's
        // download percentage while serving voice.onSongPullRequest above).
        if (metadata?.kind !== "library-song-package") {
          const currentCommandId = roomRef.current?.host
            ? hostSongCommandRef.current?.commandId
            : pendingSongCommandRef.current?.commandId;
          if (commandId && commandId !== currentCommandId) return;
        }
        setTransferStatus({ participantId, commandId, stage, percent: Number(percent) || 0 });
      };
      const canAcceptSongPackage = (participantId, metadata) => {
        const pending = pendingSongCommandRef.current;
        return (
          isCurrentConnection() &&
          metadata?.kind === "song-package" &&
          !!metadata.songId &&
          !!metadata.commandId &&
          pending?.commandId === metadata.commandId &&
          pending.songId === metadata.songId &&
          pending.revision === metadata.revision &&
          !pending.__originatedHere &&
          participantsRef.current.some(
            (participant) => participant.id === participantId && participant.role === "host"
          )
        );
      };
      const canAcceptLibrarySongPackage = (participantId, metadata) => {
        const pending = librarySyncRef.current;
        return (
          isCurrentConnection() &&
          !!pending &&
          metadata?.kind === "library-song-package" &&
          pending.commandId === metadata.commandId &&
          pending.songId === metadata.songId &&
          pending.ownerId === participantId
        );
      };
      voice.canAcceptFile = (participantId, metadata) =>
        metadata?.kind === "library-song-package"
          ? canAcceptLibrarySongPackage(participantId, metadata)
          : canAcceptSongPackage(participantId, metadata);

      const handleLibrarySongFile = async (participantId, blob, metadata, signal) => {
        const pending = librarySyncRef.current;
        if (!canAcceptLibrarySongPackage(participantId, metadata))
          throw new Error(translateSaved("Получение песни больше не разрешено"));
        try {
          setTransferStatus({
            participantId,
            commandId: metadata.commandId,
            stage: "importing",
            percent: 100
          });
          await api.importSongPackage(blob, metadata.filename, {
            ...(signal ? { signal } : {}),
            expectedRevision: metadata.revision
          });
          if (!isCurrentConnection() || librarySyncRef.current !== pending) return false;
          setTransferStatus({
            participantId,
            commandId: metadata.commandId,
            stage: "complete",
            percent: 100
          });
          pending.resolve?.();
          return true;
        } catch (error) {
          if (signal?.aborted) return false;
          if (isCurrentConnection() && librarySyncRef.current === pending) {
            pending.reject?.(
              new Error(
                translateSaved("Не удалось получить песню: {0}", { 0: getErrorMessage(error) })
              )
            );
          }
          throw error;
        }
      };

      const handleKaraokeSongFile = async (participantId, blob, metadata, signal) => {
        const pendingCommand = pendingSongCommandRef.current;
        if (!canAcceptSongPackage(participantId, metadata))
          throw new Error(translateSaved("Получение пакета песни больше не разрешено"));
        try {
          setTransferStatus({
            participantId,
            commandId: metadata.commandId,
            stage: "importing",
            percent: 100
          });
          await api.importSongPackage(blob, metadata.filename, {
            ...(signal ? { signal } : {}),
            expectedRevision: metadata.revision
          });
          const imported = await api.getSongRevision(metadata.songId);
          if (imported?.revision !== metadata.revision)
            throw new Error(
              translateSaved("Импортированная версия песни не совпадает с версией комнаты")
            );
          if (
            !isCurrentConnection() ||
            pendingSongCommandRef.current?.commandId !== metadata.commandId
          )
            return false;
          setTransferStatus({
            participantId,
            commandId: metadata.commandId,
            stage: "complete",
            percent: 100
          });
          if (
            pendingCommand?.commandId === metadata.commandId &&
            pendingCommand.songId === metadata.songId
          ) {
            client.send("sync", {
              state: {
                type: "song-ready",
                commandId: pendingCommand.commandId,
                songId: pendingCommand.songId,
                revision: pendingCommand.revision,
                requesterId: roomRef.current?.selfId
              }
            });
          }
          return true;
        } catch (error) {
          if (signal?.aborted) return false;
          if (isCurrentConnection()) {
            setTransferStatus({
              participantId,
              commandId: metadata.commandId,
              stage: "error",
              error: translateSaved("Не удалось импортировать песню: {0}", {
                0: getErrorMessage(error)
              }),
              percent: 0
            });
          }
          throw error;
        }
      };
      voice.onFile = (participantId, blob, metadata, signal) =>
        metadata?.kind === "library-song-package"
          ? handleLibrarySongFile(participantId, blob, metadata, signal)
          : handleKaraokeSongFile(participantId, blob, metadata, signal);

      // Any participant can ask any other participant for a song straight over
      // the already-open peer-to-peer channel -- this is the library "sync on
      // demand" path (OnlineRoomDock/song-card), independent of the host-driven
      // "start karaoke" push above, so it works for guest-to-guest transfers too.
      voice.onSongPullRequest = async (participantId, channel, message) => {
        if (!isCurrentConnection()) return;
        let blob;
        try {
          const revisionPayload = await api.getSongRevision(message.songId);
          const revision = revisionPayload?.revision;
          if (typeof revision !== "string" || !revision.startsWith("sha256:"))
            throw new Error(translateSaved("Песня недоступна для передачи"));
          if (!isCurrentConnection()) return;
          blob = await api.exportSongPackage(message.songId, revision);
          if (!isCurrentConnection()) return;
          await voice.sendFile(participantId, blob, {
            kind: "library-song-package",
            songId: message.songId,
            commandId: message.commandId,
            revision,
            filename: `${message.songId}.karaoke.zip`
          });
        } catch (error) {
          voice.sendSongSyncError(participantId, message.commandId, getErrorMessage(error));
        } finally {
          await blob?.cleanup?.();
        }
      };
      voice.onSongPullError = (participantId, message) => {
        const pending = librarySyncRef.current;
        if (
          !pending ||
          pending.commandId !== message.commandId ||
          pending.ownerId !== participantId
        )
          return;
        pending.reject?.(
          new Error(message.error || translateSaved("Участник не смог отправить песню"))
        );
      };
      unsubscribeRef.current = client.onMessage(
        createOnlineRoomMessageHandler({
          id,
          client,
          voice,
          roomApi: api,
          isCurrentConnection,
          roomRef,
          participantsRef,
          intentionalDisconnectRef,
          pendingSongCommandRef,
          hostSongCommandRef,
          songExportsRef,
          cleanupConnection,
          setRoom,
          setParticipants,
          setRoomUi,
          setRoomCommand,
          setVoiceError,
          setTransferStatus,
          onParticipantJoined: playParticipantJoinedSound,
          onConnectionClosed: (message = translateSaved("Соединение с комнатой потеряно.")) => {
            connectionTokenRef.current = Symbol("connection-closed");
            restoreApplicationAudio();
            cleanupConnection();
            resetRoomState();
            setVoiceError(message);
          }
        })
      );
      try {
        const normalizedId = await client.connect({ id, name, host, hostToken });
        if (!isCurrentConnection())
          throw new Error(translateSaved("Подключение отменено новым запросом"));

        // Show the room UI as soon as the WebSocket is connected. The server
        // room-state packet will replace the temporary self id a moment later.
        const pendingSelfId = `pending-${normalizedId}`;
        setRoom({
          id: normalizedId,
          selfId: pendingSelfId,
          host: Boolean(host),
          role: host ? "host" : "guest"
        });
        setParticipants([
          {
            id: pendingSelfId,
            name: name?.trim() || translateSaved("Гость"),
            role: host ? "host" : "guest",
            pending: true
          }
        ]);
        voice
          .start()
          .then((stream) => {
            if (!isCurrentConnection()) {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }
            startSpeakingMeter("local", stream);
            voice.setMicrophoneMuted(microphoneMutedRef.current);
            client.send("presence", { micMuted: microphoneMutedRef.current });
          })
          .catch((error) => {
            if (!isCurrentConnection()) return;
            setVoiceError(
              translateSaved("Комната подключена без голоса: {0}", {
                0: getErrorMessage(error, translateSaved("нет доступа к микрофону"))
              })
            );
          });
        return normalizedId;
      } catch (error) {
        if (isCurrentConnection()) cleanupConnection();
        else {
          voice.stop();
          client.disconnect();
        }
        throw error;
      }
    },
    // Stryker disable next-line ArrayDeclaration: all callback dependencies are stable.
    [
      attachRemoteStream,
      cleanupConnection,
      removeRemoteAudio,
      resetRoomState,
      restoreApplicationAudio,
      setParticipants,
      setRoom,
      setTransferStatus,
      startSpeakingMeter
    ]
  );
  useEffect(
    () => () => {
      restoreApplicationAudio();
      cleanupConnection();
    },
    [cleanupConnection, restoreApplicationAudio]
  );
  const createRoom = useCallback(
    (name) => connect({ id: createRoomId(), name, host: true, hostToken: createHostToken() }),
    // Stryker disable next-line ArrayDeclaration: connect is stable.
    [connect]
  );
  const joinRoom = useCallback(
    (id, name) => connect({ id, name, host: false }),
    // Stryker disable next-line ArrayDeclaration: connect is stable.
    [connect]
  );
  const togglePersonMuted = useCallback(
    (id) => {
      setMutedPeople((items) => {
        const next = new Set(items);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        mutedPeopleRef.current = next;
        queueMicrotask(applyRemoteAudioMute);
        return next;
      });
    },
    // Stryker disable next-line ArrayDeclaration: applyRemoteAudioMute is stable.
    [applyRemoteAudioMute]
  );

  const setParticipantVolume = useCallback(
    (id, value) => {
      const nextValue = Math.max(0, Math.min(1, Number(value) || 0));
      participantVolumesRef.current = { ...participantVolumesRef.current, [id]: nextValue };
      setParticipantVolumes((current) => ({ ...current, [id]: nextValue }));
      applyParticipantVolume(id, nextValue);
    },
    [applyParticipantVolume]
  );

  const togglePersonEffects = useCallback(
    (id) => {
      setEffectPeople((items) => {
        const next = new Set(items);
        const enabled = !next.has(id);
        if (enabled) next.add(id);
        else next.delete(id);
        if (!enabled) queueMicrotask(() => applyParticipantEffects(id, false));
        return next;
      });
    },
    // Stryker disable next-line ArrayDeclaration: applyParticipantEffects is stable.
    [applyParticipantEffects]
  );
  const { effectsByParticipant } = roomUi;
  useEffect(() => {
    roomUiRef.current = roomUi;
  }, [roomUi]);
  useEffect(() => {
    effectPeople.forEach((id) => applyParticipantEffects(id, true));
  }, [applyParticipantEffects, effectPeople, effectsByParticipant]);
  const { openKaraoke, syncCommand, syncUi } = useOnlineRoomCommands({
    api,
    clientRef,
    connectionTokenRef,
    hostSongCommandRef,
    participantsRef,
    roomRef,
    voiceRef
  });
  const value = useOnlineRoomValue({
    createRoom,
    effectPeople,
    joinRoom,
    leaveRoom,
    microphoneMuted,
    mutedPeople,
    openKaraoke,
    participants,
    participantVolumes,
    requestMicrophoneAccess,
    requestSongSync,
    room,
    roomCommand,
    roomSoundMuted,
    roomUi,
    setLocalMonitoring,
    setMicrophoneMuted,
    setParticipantVolume,
    setRoomSoundMuted,
    syncCommand,
    syncUi,
    togglePersonEffects,
    togglePersonMuted,
    transferStatus,
    voiceError
  });
  const speakingValue = useMemo(
    () => ({ localSpeakingLevel, speakingLevels }),
    [localSpeakingLevel, speakingLevels]
  );
  return (
    <OnlineRoomContext.Provider value={value}>
      <OnlineRoomSpeakingContext.Provider value={speakingValue}>
        {children}
      </OnlineRoomSpeakingContext.Provider>
    </OnlineRoomContext.Provider>
  );
}
export function useOnlineRoom() {
  return useContext(OnlineRoomContext);
}
export function useOnlineRoomSpeaking() {
  return useContext(OnlineRoomSpeakingContext);
}
