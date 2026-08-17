import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
import { playParticipantJoinedSound } from "./onlineRoomAudio";
import { createOnlineRoomMessageHandler } from "./onlineRoomMessages";

const OnlineRoomContext = createContext(null);
const OFF = false;
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
        const activeCommandIds = new Set(
          [hostSongCommandRef.current?.commandId, pendingSongCommandRef.current?.commandId].filter(
            Boolean
          )
        );
        for (const activeCommandId of songExportsRef.current.keys())
          activeCommandIds.add(activeCommandId);
        if (commandId && !activeCommandIds.has(commandId)) return;
        setTransferStatus({
          participantId,
          commandId,
          songId: metadata?.songId,
          stage,
          percent: Number(percent) || 0
        });
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
          (pending.ownerId
            ? participantId === pending.ownerId
            : participantsRef.current.some(
                (participant) => participant.id === participantId && participant.role === "host"
              ))
        );
      };
      voice.canAcceptFile = canAcceptSongPackage;
      voice.onFile = async (participantId, blob, metadata, signal) => {
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
            if (pendingCommand.__manual) {
              pendingSongCommandRef.current = null;
              pendingCommand.resolve?.(true);
            } else {
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
          }
          return true;
        } catch (error) {
          if (signal?.aborted) return false;
          if (isCurrentConnection()) {
            const errorText = translateSaved("Не удалось импортировать песню: {0}", {
              0: getErrorMessage(error)
            });
            setTransferStatus({
              participantId,
              commandId: metadata.commandId,
              songId: metadata.songId,
              stage: "error",
              error: errorText,
              percent: 0
            });
            if (pendingCommand?.__manual && pendingCommand.commandId === metadata.commandId) {
              pendingSongCommandRef.current = null;
              pendingCommand.reject?.(new Error(errorText));
            }
          }
          throw error;
        }
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
          onConnectionClosed: () => {
            connectionTokenRef.current = Symbol("connection-closed");
            restoreApplicationAudio();
            cleanupConnection();
            resetRoomState();
            setVoiceError(translateSaved("Соединение с комнатой потеряно."));
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
  const syncSong = useCallback(
    async (song) => {
      if (!roomRef.current || !song?.id) return false;
      try {
        const local = await api.getSongRevision(song.id);
        if (local?.revision && local.revision === song.__roomRevision) return true;
      } catch {
        // Missing locally: request the processed package from its room owner.
      }
      const ownerId = song.__roomOwnerId;
      const revision = song.__roomRevision;
      if (!ownerId || ownerId === roomRef.current.selfId || !revision)
        throw new Error(
          translateSaved("Не удалось определить владельца или версию песни в комнате")
        );
      const previous = pendingSongCommandRef.current;
      previous?.reject?.(new Error(translateSaved("Передача песни заменена новым запросом")));
      if (previous?.commandId) voiceRef.current?.cancelTransfersByCommandId?.(previous.commandId);
      const commandId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      return new Promise((resolve, reject) => {
        const timer = globalThis.setTimeout(() => {
          if (pendingSongCommandRef.current?.commandId !== commandId) return;
          pendingSongCommandRef.current = null;
          reject(new Error(translateSaved("Передача песни остановилась: нет ответа от участника")));
        }, 5 * 60_000);
        const finish = (callback) => (value) => {
          globalThis.clearTimeout(timer);
          callback(value);
        };
        pendingSongCommandRef.current = {
          type: "sync-song",
          songId: song.id,
          commandId,
          revision,
          ownerId,
          __manual: true,
          resolve: finish(resolve),
          reject: finish(reject)
        };
        setTransferStatus({
          participantId: ownerId,
          commandId,
          songId: song.id,
          stage: "waiting",
          percent: 0
        });
        const sent = clientRef.current?.send("sync", {
          state: {
            type: "song-request",
            songId: song.id,
            commandId,
            revision,
            ownerId,
            requesterId: roomRef.current.selfId
          }
        });
        if (!sent) {
          pendingSongCommandRef.current = null;
          globalThis.clearTimeout(timer);
          reject(new Error(translateSaved("Не удалось отправить запрос на синхронизацию песни")));
        }
      });
    },
    [setTransferStatus]
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
        queueMicrotask(() => applyParticipantEffects(id, enabled));
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
    localSpeakingLevel,
    microphoneMuted,
    mutedPeople,
    openKaraoke,
    participants,
    participantVolumes,
    requestMicrophoneAccess,
    room,
    roomCommand,
    roomSoundMuted,
    roomUi,
    setLocalMonitoring,
    setMicrophoneMuted,
    setParticipantVolume,
    setRoomSoundMuted,
    speakingLevels,
    syncCommand,
    syncSong,
    syncUi,
    togglePersonEffects,
    togglePersonMuted,
    transferStatus,
    transferStatuses,
    voiceError
  });
  return <OnlineRoomContext.Provider value={value}>{children}</OnlineRoomContext.Provider>;
}
export function useOnlineRoom() {
  return useContext(OnlineRoomContext);
}
