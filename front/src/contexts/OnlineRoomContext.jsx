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
import {
  createRoomId,
  normalizeRoomId,
  OnlineRoomClient,
  OnlineVoiceMesh
} from "../services/onlineRoom";
import { getErrorMessage } from "../utils/errors";
import { openKaraokeInRoom } from "./onlineRoomActions";
import { createOnlineRoomMessageHandler } from "./onlineRoomMessages";
import useApplicationAudioMute from "./hooks/useApplicationAudioMute";
import useSpeakingLevels from "./hooks/useSpeakingLevels";

const OnlineRoomContext = createContext(null);

export function OnlineRoomProvider({ children }) {
  const clientRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const voiceRef = useRef(null);
  const remoteAudioRef = useRef(new Map());
  const previousMicMutedRef = useRef(false);
  const microphoneMutedRef = useRef(false);
  const roomRef = useRef(null);
  const mutedPeopleRef = useRef(new Set());
  const roomSoundMutedRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const pendingSongCommandRef = useRef(null);
  const connectionVersionRef = useRef(0);

  const [room, setRoomState] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [mutedPeople, setMutedPeople] = useState(() => new Set());
  const [microphoneMuted, setMicrophoneMutedState] = useState(false);
  const [roomSoundMuted, setRoomSoundMutedState] = useState(false);
  const [roomUi, setRoomUi] = useState({});
  const [roomCommand, setRoomCommand] = useState(null);
  const [voiceError, setVoiceError] = useState("");
  const { muteApplicationAudio, restoreApplicationAudio } =
    useApplicationAudioMute(roomSoundMuted);
  const {
    localSpeakingLevel,
    speakingLevels,
    startSpeakingMeter,
    stopSpeakingMeter,
    stopAllSpeakingMeters
  } = useSpeakingLevels();

  const setRoom = useCallback((next) => {
    roomRef.current = next;
    setRoomState(next);
  }, []);

  const removeRemoteAudio = useCallback((participantId) => {
    stopSpeakingMeter(participantId);
    const audio = remoteAudioRef.current.get(participantId);
    if (!audio) return;
    audio.pause();
    audio.srcObject = null;
    audio.remove();
    remoteAudioRef.current.delete(participantId);
  }, [stopSpeakingMeter]);

  const applyRemoteAudioMute = useCallback(() => {
    for (const [participantId, audio] of remoteAudioRef.current) {
      audio.muted =
        roomSoundMutedRef.current || mutedPeopleRef.current.has(participantId);
    }
  }, []);

  const cleanupConnection = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    voiceRef.current?.stop();
    stopAllSpeakingMeters();
    voiceRef.current = null;
    for (const id of [...remoteAudioRef.current.keys()]) removeRemoteAudio(id);
    clientRef.current?.disconnect();
    clientRef.current = null;
  }, [removeRemoteAudio, stopAllSpeakingMeters]);

  const setMicrophoneMuted = useCallback((muted, broadcast = true) => {
    const next = Boolean(muted);
    voiceRef.current?.setMicrophoneMuted(next);
    microphoneMutedRef.current = next;
    setMicrophoneMutedState(next);
    if (broadcast) clientRef.current?.send("presence", { micMuted: next });
  }, []);

  const requestMicrophoneAccess = useCallback(async () => {
    const voice = voiceRef.current;
    if (!voice) {
      setVoiceError("Сначала подключитесь к комнате.");
      return false;
    }

    setVoiceError("");
    try {
      const stream = await voice.start();
      if (voiceRef.current !== voice) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      startSpeakingMeter("local", stream);
      const muted = microphoneMutedRef.current || roomSoundMutedRef.current;
      voice.setMicrophoneMuted(muted);
      clientRef.current?.send("presence", { micMuted: muted });
      return true;
    } catch (error) {
      if (voiceRef.current !== voice) return false;
      const message = getErrorMessage(error, "нет доступа к микрофону");
      setVoiceError(
        `Не удалось получить доступ к микрофону: ${message}. Проверьте разрешение Windows и повторите попытку.`
      );
      return false;
    }
  }, [startSpeakingMeter]);

  const setRoomSoundMuted = useCallback(
    (muted) => {
      const next = Boolean(muted);
      if (next === roomSoundMutedRef.current) return;
      roomSoundMutedRef.current = next;
      setRoomSoundMutedState(next);

      if (next) {
        previousMicMutedRef.current = microphoneMutedRef.current;
        setMicrophoneMuted(true);
        muteApplicationAudio(document);
      } else {
        restoreApplicationAudio();
        setMicrophoneMuted(previousMicMutedRef.current);
      }
      applyRemoteAudioMute();
    },
    [
      applyRemoteAudioMute,
      muteApplicationAudio,
      restoreApplicationAudio,
      setMicrophoneMuted
    ]
  );

  const leaveRoom = useCallback(async () => {
    connectionVersionRef.current += 1;
    intentionalDisconnectRef.current = true;
    restoreApplicationAudio();
    cleanupConnection();
    setRoom(null);
    setParticipants([]);
    mutedPeopleRef.current = new Set();
    setMutedPeople(new Set());
    roomSoundMutedRef.current = false;
    setRoomSoundMutedState(false);
    microphoneMutedRef.current = false;
    setMicrophoneMutedState(false);
    setRoomUi({});
    setRoomCommand(null);
    setVoiceError("");
    intentionalDisconnectRef.current = false;
  }, [cleanupConnection, restoreApplicationAudio, setRoom]);

  const connect = useCallback(
    async ({ id, name, host }) => {
      const connectionVersion = connectionVersionRef.current + 1;
      connectionVersionRef.current = connectionVersion;
      intentionalDisconnectRef.current = true;
      cleanupConnection();
      intentionalDisconnectRef.current = false;
      setVoiceError("");

      const client = new OnlineRoomClient();
      const voice = new OnlineVoiceMesh(client);
      clientRef.current = client;
      voiceRef.current = voice;

      const isCurrentConnection = () =>
        connectionVersion === connectionVersionRef.current &&
        clientRef.current === client &&
        voiceRef.current === voice;

      voice.onRemoteStream = (participantId, stream) => {
        if (!isCurrentConnection()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        removeRemoteAudio(participantId);
        const audio = document.createElement("audio");
        audio.dataset.onlineRoomParticipant = participantId;
        audio.autoplay = true;
        audio.playsInline = true;
        audio.srcObject = stream;
        audio.style.display = "none";
        document.body.append(audio);
        remoteAudioRef.current.set(participantId, audio);
        startSpeakingMeter(participantId, stream);
        applyRemoteAudioMute();
        audio.play().catch(() => {
          if (!isCurrentConnection()) return;
          setVoiceError(
            "Нажмите в любом месте приложения, чтобы разрешить звук комнаты."
          );
        });
      };
      voice.onPeerClosed = (participantId) => {
        if (isCurrentConnection()) removeRemoteAudio(participantId);
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
          setVoiceError("Импортируем песню в локальную библиотеку…");
          await api.importSongPackage(blob, metadata.filename);
          if (!isCurrentConnection()) return;
          const pendingCommand = pendingSongCommandRef.current;
          pendingSongCommandRef.current = null;
          setVoiceError("");
          if (pendingCommand?.songId === metadata.songId) {
            if (pendingCommand.__originatedHere) {
              clientRef.current?.send("sync", {
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
            setVoiceError(
              `Не удалось импортировать песню: ${getErrorMessage(error)}`
            );
          }
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
          setVoiceError
        })
      );

      try {
        const normalizedId = await client.connect({ id, name, host });
        if (connectionVersion !== connectionVersionRef.current) {
          voice.stop();
          client.disconnect();
          throw new Error("Подключение отменено новым запросом");
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
            name: name?.trim() || "Гость",
            role: host ? "host" : "guest",
            pending: true
          }
        ]);

        voice
          .start()
          .then((stream) => {
            if (connectionVersion !== connectionVersionRef.current) {
              stream.getTracks().forEach((track) => track.stop());
              return;
            }
            startSpeakingMeter("local", stream);
            voice.setMicrophoneMuted(
              microphoneMutedRef.current || roomSoundMutedRef.current
            );
            client.send("presence", {
              micMuted: microphoneMutedRef.current || roomSoundMutedRef.current
            });
          })
          .catch((error) => {
            if (!isCurrentConnection()) return;
            setVoiceError(
              `Комната подключена без голоса: ${getErrorMessage(error, "нет доступа к микрофону")}`
            );
          });
        return normalizedId;
      } catch (error) {
        if (connectionVersion === connectionVersionRef.current) {
          cleanupConnection();
        } else {
          voice.stop();
          client.disconnect();
        }
        throw error;
      }
    },
    [
      applyRemoteAudioMute,
      cleanupConnection,
      removeRemoteAudio,
      setRoom,
      startSpeakingMeter
    ]
  );

  useEffect(() => () => cleanupConnection(), [cleanupConnection]);

  const createRoom = useCallback(
    (name) => connect({ id: createRoomId(), name, host: true }),
    [connect]
  );

  const joinRoom = useCallback(
    (id, name) => connect({ id, name, host: false }),
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
    [applyRemoteAudioMute]
  );

  const syncUi = useCallback((state) => {
    clientRef.current?.send("ui", { state });
  }, []);

  const syncCommand = useCallback((state) => {
    clientRef.current?.send("sync", { state });
  }, []);

  const openKaraoke = useCallback((songId) => {
    const client = clientRef.current;
    const connectionVersion = connectionVersionRef.current;

    return openKaraokeInRoom({
      songId,
      room: roomRef.current,
      client,
      roomApi: api,
      isCurrentConnection: () =>
        connectionVersion === connectionVersionRef.current &&
        clientRef.current === client,
      pendingSongCommandRef,
      setVoiceError
    });
  }, []);

  const value = useMemo(
    () => ({
      room,
      participants,
      mutedPeople,
      microphoneMuted,
      roomSoundMuted,
      roomUi,
      roomCommand,
      voiceError,
      localSpeakingLevel,
      speakingLevels,
      createRoom,
      joinRoom,
      leaveRoom,
      requestMicrophoneAccess,
      setMicrophoneMuted,
      setRoomSoundMuted,
      togglePersonMuted,
      syncUi,
      syncCommand,
      openKaraoke
    }),
    [
      createRoom,
      joinRoom,
      leaveRoom,
      microphoneMuted,
      mutedPeople,
      participants,
      room,
      roomCommand,
      roomSoundMuted,
      roomUi,
      requestMicrophoneAccess,
      setMicrophoneMuted,
      setRoomSoundMuted,
      voiceError,
      localSpeakingLevel,
      speakingLevels,
      togglePersonMuted,
      syncUi,
      syncCommand,
      openKaraoke
    ]
  );

  return (
    <OnlineRoomContext.Provider value={value}>
      {children}
    </OnlineRoomContext.Provider>
  );
}

export function useOnlineRoom() {
  return useContext(OnlineRoomContext);
}
