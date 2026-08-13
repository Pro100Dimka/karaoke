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
  createRoomId,
  OnlineRoomClient,
  OnlineVoiceMesh
} from "../services/onlineRoom";
import { getErrorMessage } from "../utils/errors";
import useApplicationAudioMute from "./hooks/useApplicationAudioMute";
import useSpeakingLevels from "./hooks/useSpeakingLevels";
import { openKaraokeInRoom } from "./onlineRoomActions";
import { createOnlineRoomMessageHandler } from "./onlineRoomMessages";

const OnlineRoomContext = createContext(null);
export function OnlineRoomProvider({ children }) {
  const clientRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const voiceRef = useRef(null);
  const remoteAudioRef = useRef(new Map());
  const remoteEffectsRef = useRef(new Map());
  const roomUiRef = useRef({});
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
  const [effectPeople, setEffectPeople] = useState(() => new Set());
  const [microphoneMuted, setMicrophoneMutedState] = useState(false);
  const [roomSoundMuted, setRoomSoundMutedState] = useState(false);
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
  const setRoom = useCallback((next) => {
    roomRef.current = next;
    setRoomState(next);
  }, []);
  const removeRemoteAudio = useCallback(
    (participantId) => {
      stopSpeakingMeter(participantId);
      const effectGraph = remoteEffectsRef.current.get(participantId);
      remoteEffectsRef.current.delete(participantId);
      effectGraph?.context.close?.().catch(() => {});
      const audio = remoteAudioRef.current.get(participantId);
      if (!audio) return;
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      remoteAudioRef.current.delete(participantId);
    },
    [stopSpeakingMeter]
  );
  const applyRemoteAudioMute = useCallback(() => {
    for (const [participantId, audio] of remoteAudioRef.current) {
      const muted =
        roomSoundMutedRef.current || mutedPeopleRef.current.has(participantId);
      const effectGraph = remoteEffectsRef.current.get(participantId);
      audio.muted = muted || Boolean(effectGraph);
      if (effectGraph) effectGraph.master.gain.value = muted ? 0 : 1;
    }
  }, []);
  const applyParticipantEffects = useCallback(
    (participantId, enabled) => {
      const previous = remoteEffectsRef.current.get(participantId);
      remoteEffectsRef.current.delete(participantId);
      previous?.context.close?.().catch(() => {});
      const audio = remoteAudioRef.current.get(participantId);
      const stream = audio?.srcObject;
      if (!enabled || !stream) {
        applyRemoteAudioMute();
        return;
      }
      const AudioContextClass =
        globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) {
        applyRemoteAudioMute();
        return;
      }
      const effects =
        roomUiRef.current.effectsByParticipant?.[participantId] || {};
      const amount = (name) =>
        Math.max(0, Math.min(1, Number(effects[name]) || 0));
      const context = new AudioContextClass({ latencyHint: "interactive" });
      const source = context.createMediaStreamSource(stream);
      const master = context.createGain();
      source.connect(master);

      const echo = amount("echo");
      const delayAmount = amount("delay");
      if (echo || delayAmount) {
        const delay = context.createDelay(1);
        const feedback = context.createGain();
        const wet = context.createGain();
        delay.delayTime.value = 0.06 + delayAmount * 0.34;
        feedback.gain.value = Math.min(0.72, echo * 0.55 + delayAmount * 0.3);
        wet.gain.value = Math.min(0.65, echo * 0.46 + delayAmount * 0.24);
        source.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(master);
      }

      const reverb = amount("reverb");
      if (reverb) {
        const convolver = context.createConvolver();
        const wet = context.createGain();
        const frames = Math.floor(context.sampleRate * (0.35 + reverb * 1.15));
        const impulse = context.createBuffer(2, frames, context.sampleRate);
        for (
          let channel = 0;
          channel < impulse.numberOfChannels;
          channel += 1
        ) {
          const data = impulse.getChannelData(channel);
          for (let index = 0; index < frames; index += 1) {
            data[index] =
              (Math.random() * 2 - 1) *
              (1 - index / frames) ** (1.5 + reverb * 2);
          }
        }
        convolver.buffer = impulse;
        wet.gain.value = Math.min(0.58, reverb * 0.48);
        source.connect(convolver);
        convolver.connect(wet);
        wet.connect(master);
      }
      master.connect(context.destination);
      remoteEffectsRef.current.set(participantId, { context, master });
      context.resume?.().catch(() => {});
      applyRemoteAudioMute();
    },
    [applyRemoteAudioMute]
  );
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
    if (broadcast)
      clientRef.current?.send("presence", {
        micMuted: next
      });
  }, []);
  const requestMicrophoneAccess = useCallback(async () => {
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
      const muted = microphoneMutedRef.current || roomSoundMutedRef.current;
      voice.setMicrophoneMuted(muted);
      clientRef.current?.send("presence", {
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
    setEffectPeople(new Set());
    roomSoundMutedRef.current = false;
    setRoomSoundMutedState(false);
    microphoneMutedRef.current = false;
    setMicrophoneMutedState(false);
    setRoomUi({});
    setRoomCommand(null);
    pendingSongCommandRef.current = null;
    setVoiceError("");
    intentionalDisconnectRef.current = false;
  }, [cleanupConnection, restoreApplicationAudio, setRoom]);
  const connect = useCallback(
    async ({ id, name, host }) => {
      const connectionVersion = connectionVersionRef.current + 1;
      connectionVersionRef.current = connectionVersion;
      intentionalDisconnectRef.current = true;
      restoreApplicationAudio();
      cleanupConnection();
      intentionalDisconnectRef.current = false;
      setRoom(null);
      setParticipants([]);
      mutedPeopleRef.current = new Set();
      setMutedPeople(new Set());
      setEffectPeople(new Set());
      roomSoundMutedRef.current = false;
      setRoomSoundMutedState(false);
      setRoomUi({});
      setRoomCommand(null);
      pendingSongCommandRef.current = null;
      setVoiceError("");
      setTransferStatus(null);
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
          setTransferStatus
        })
      );
      try {
        const normalizedId = await client.connect({
          id,
          name,
          host
        });
        if (connectionVersion !== connectionVersionRef.current) {
          voice.stop();
          client.disconnect();
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
      restoreApplicationAudio,
      setRoom,
      startSpeakingMeter
    ]
  );
  useEffect(() => () => cleanupConnection(), [cleanupConnection]);
  const createRoom = useCallback(
    (name) =>
      connect({
        id: createRoomId(),
        name,
        host: true
      }),
    [connect]
  );
  const joinRoom = useCallback(
    (id, name) =>
      connect({
        id,
        name,
        host: false
      }),
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
    [applyParticipantEffects]
  );
  const { effectsByParticipant } = roomUi;
  useEffect(() => {
    roomUiRef.current = roomUi;
  }, [roomUi]);
  useEffect(() => {
    effectPeople.forEach((id) => applyParticipantEffects(id, true));
  }, [applyParticipantEffects, effectPeople, effectsByParticipant]);
  const syncUi = useCallback((state) => {
    clientRef.current?.send("ui", {
      state
    });
  }, []);
  const syncCommand = useCallback((state) => {
    clientRef.current?.send("sync", {
      state
    });
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
      setTransferStatus
    });
  }, []);
  const value = useMemo(
    () => ({
      room,
      participants,
      mutedPeople,
      effectPeople,
      microphoneMuted,
      roomSoundMuted,
      roomUi,
      roomCommand,
      voiceError,
      transferStatus,
      localSpeakingLevel,
      speakingLevels,
      createRoom,
      joinRoom,
      leaveRoom,
      requestMicrophoneAccess,
      setMicrophoneMuted,
      setRoomSoundMuted,
      togglePersonMuted,
      togglePersonEffects,
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
      effectPeople,
      participants,
      room,
      roomCommand,
      roomSoundMuted,
      roomUi,
      requestMicrophoneAccess,
      setMicrophoneMuted,
      setRoomSoundMuted,
      voiceError,
      transferStatus,
      localSpeakingLevel,
      speakingLevels,
      togglePersonMuted,
      togglePersonEffects,
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
