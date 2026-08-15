import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import { api } from "../api/client";
import { translateSaved } from "../i18n/runtime";
import { playParticipantJoinedSound } from "./onlineRoomAudio";
import {
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
  const intentionalDisconnectRef = useRef(OFF);
  const pendingSongCommandRef = useRef(null);
  const connectionTokenRef = useRef(null);
  const [room, setRoomState] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [mutedPeople, setMutedPeople] = useState(() => new Set());
  const [effectPeople, setEffectPeople] = useState(() => new Set());
  const [microphoneMuted, setMicrophoneMutedState] = useState(OFF);
  const [roomSoundMuted, setRoomSoundMutedState] = useState(OFF);
  const [roomUi, setRoomUi] = useState({});
  const [roomCommand, setRoomCommand] = useState(null);
  const [voiceError, setVoiceError] = useState("");
  const [transferStatus, setTransferStatus] = useState(null);
  const { muteApplicationAudio, restoreApplicationAudio } =
    useApplicationAudioMute(roomSoundMuted);
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
    setLocalMonitoring,
    stopLocalMonitoring
  } = useOnlineRoomAudio({
    mutedPeopleRef,
    roomSoundMutedRef,
    roomUiRef,
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
      if (broadcast)
        clientRef.current?.send("presence", {
          micMuted: next
        });
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
        clientRef.current.send("presence", {
          micMuted: muted
        });
        return true;
      } catch (error) {
        if (voiceRef.current !== voice) return false;
        const message = getErrorMessage(
          error,
          translateSaved("нет доступа к микрофону")
        );
        setVoiceError(
          translateSaved(
            "Не удалось получить доступ к микрофону: {0}. Проверьте разрешение Windows и повторите попытку.",
            {
              0: message
            }
          )
        );
        return false;
      }
    },
    // Stryker disable next-line ArrayDeclaration: startSpeakingMeter is stable.
    [startSpeakingMeter]
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
    [
      applyRemoteAudioMute,
      muteApplicationAudio,
      restoreApplicationAudio
    ]
  );
  const resetRoomState = useCallback(
    () => {
      setRoom(null);
      setParticipants([]);
      mutedPeopleRef.current = new Set();
      setMutedPeople(new Set());
      setEffectPeople(new Set());
      roomSoundMutedRef.current = OFF;
      setRoomSoundMutedState(OFF);
      microphoneMutedRef.current = OFF;
      setMicrophoneMutedState(OFF);
      setRoomUi({});
      setRoomCommand(null);
      pendingSongCommandRef.current = null;
      setTransferStatus(null);
      setVoiceError("");
    },
    // Stryker disable next-line ArrayDeclaration: setRoom is stable.
    [setRoom]
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
    async ({ id, name, host }) => {
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
      const isCurrentConnection = () =>
        connectionToken === connectionTokenRef.current;
      voice.onRemoteStream = (participantId, stream) => {
        if (!isCurrentConnection()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        attachRemoteStream(participantId, stream, () => {
          if (!isCurrentConnection()) return;
          setVoiceError(
            translateSaved(
              "Нажмите в любом месте приложения, чтобы разрешить звук комнаты."
            )
          );
        });
      };
      voice.onPeerClosed = (participantId) => {
        if (isCurrentConnection()) removeRemoteAudio(participantId);
      };
      voice.onTransferProgress = ({ stage, percent }) => {
        if (!isCurrentConnection()) return;
        setTransferStatus(
          stage === "complete" ? null : { stage, percent: Number(percent) || 0 }
        );
      };
      voice.onFile = async (_participantId, blob, metadata) => {
        if (
          !isCurrentConnection() ||
          metadata?.kind !== "song-package" ||
          !metadata.songId
        ) {
          return;
        }
        try {
          setTransferStatus({ stage: "importing", percent: 100 });
          await api.importSongPackage(blob, metadata.filename);
          if (!isCurrentConnection()) return;
          const pendingCommand = pendingSongCommandRef.current;
          pendingSongCommandRef.current = null;
          setTransferStatus(null);
          if (pendingCommand?.songId === metadata.songId) {
            if (pendingCommand.__originatedHere) {
              client.send("sync", {
                state: {
                  type: "open-karaoke",
                  songId: pendingCommand.songId
                }
              });
            }
            setRoomCommand({
              ...pendingCommand,
              __eventId: `import-${Date.now()}-${Math.random()}`
            });
          }
        } catch (error) {
          if (isCurrentConnection()) {
            setTransferStatus({
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
      unsubscribeRef.current = client.onMessage(
        createOnlineRoomMessageHandler({
          id,
          client,
          voice,
          roomApi: api,
          isCurrentConnection,
          roomRef,
          intentionalDisconnectRef,
          pendingSongCommandRef,
          cleanupConnection,
          setRoom,
          setParticipants,
          setRoomUi,
          setRoomCommand,
          setVoiceError,
          setTransferStatus,
          onParticipantJoined: playParticipantJoinedSound
        })
      );
      try {
        const normalizedId = await client.connect({
          id,
          name,
          host
        });
        if (!isCurrentConnection()) {
          throw new Error(
            translateSaved("Подключение отменено новым запросом")
          );
        }

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
            client.send("presence", {
              micMuted: microphoneMutedRef.current
            });
          })
          .catch((error) => {
            if (!isCurrentConnection()) return;
            setVoiceError(
              translateSaved("Комната подключена без голоса: {0}", {
                0: getErrorMessage(
                  error,
                  translateSaved("нет доступа к микрофону")
                )
              })
            );
          });
        return normalizedId;
      } catch (error) {
        if (isCurrentConnection()) {
          cleanupConnection();
        } else {
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
      setRoom,
      startSpeakingMeter
    ]
  );
  useEffect(
    () => () => cleanupConnection(),
    // Stryker disable next-line ArrayDeclaration: cleanupConnection is stable.
    [cleanupConnection]
  );
  const createRoom = useCallback(
    (name) =>
      connect({
        id: createRoomId(),
        name,
        host: true
      }),
    // Stryker disable next-line ArrayDeclaration: connect is stable.
    [connect]
  );
  const joinRoom = useCallback(
    (id, name) =>
      connect({
        id,
        name,
        host: false
      }),
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
    clientRef,
    connectionTokenRef,
    pendingSongCommandRef,
    roomRef,
    setTransferStatus
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
    requestMicrophoneAccess,
    room,
    roomCommand,
    roomSoundMuted,
    roomUi,
    setLocalMonitoring,
    setMicrophoneMuted,
    setRoomSoundMuted,
    speakingLevels,
    syncCommand,
    syncUi,
    togglePersonEffects,
    togglePersonMuted,
    transferStatus,
    voiceError
  });
  return (
    <OnlineRoomContext.Provider value={value}>
      {children}
    </OnlineRoomContext.Provider>
  );
}
export function useOnlineRoom() {
  return useContext(OnlineRoomContext);
}
