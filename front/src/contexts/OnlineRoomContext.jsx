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
const OFF = false;
export function OnlineRoomProvider({ children }) {
  const clientRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const voiceRef = useRef(null);
  const remoteAudioRef = useRef(new Map());
  const remoteEffectsRef = useRef(new Map());
  const localMonitorRef = useRef(null);
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
  const playParticipantJoinedSound = useCallback(() => {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const context = new AudioContextClass({ latencyHint: "interactive" });
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
      gain.connect(context.destination);
      [660, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        oscillator.start(context.currentTime + index * 0.045);
        oscillator.stop(context.currentTime + 0.2);
      });
      globalThis.setTimeout(() => context.close().catch(() => {}), 300);
    } catch {
      // A notification sound is optional and must never affect room state.
    }
  }, []);
  const setRoom = useCallback(
    (next) => {
      roomRef.current = next;
      setRoomState(next);
    },
    // Stryker disable next-line ArrayDeclaration: React setters and refs are stable.
    []
  );
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
    // Stryker disable next-line ArrayDeclaration: stopSpeakingMeter is stable.
    [stopSpeakingMeter]
  );
  const applyRemoteAudioMute = useCallback(
    () => {
      for (const [participantId, audio] of remoteAudioRef.current) {
        const muted =
          roomSoundMutedRef.current ||
          mutedPeopleRef.current.has(participantId);
        const effectGraph = remoteEffectsRef.current.get(participantId);
        audio.muted = muted || Boolean(effectGraph);
        if (effectGraph) effectGraph.master.gain.value = muted ? 0 : 1;
      }
    },
    // Stryker disable next-line ArrayDeclaration: the callback closes over refs only.
    []
  );
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
          // Stryker disable next-line EqualityOperator: a typed-array write at
          // index `frames` is ignored, so `<` and `<=` are equivalent here.
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
    // Stryker disable next-line ArrayDeclaration: applyRemoteAudioMute is stable.
    [applyRemoteAudioMute]
  );
  const stopLocalMonitoring = useCallback(() => {
    const monitor = localMonitorRef.current;
    localMonitorRef.current = null;
    if (!monitor) return;
    try {
      monitor.source.disconnect();
      monitor.gain.disconnect();
    } catch {
      // Already disconnected.
    }
    monitor.context.close?.().catch(() => {});
  }, []);
  const setLocalMonitoring = useCallback(
    async (enabled) => {
      if (!enabled) {
        stopLocalMonitoring();
        return false;
      }
      if (localMonitorRef.current) return true;
      const voice = voiceRef.current;
      if (!voice) return false;
      const stream = await voice.start();
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) return false;
      const context = new AudioContextClass({ latencyHint: "interactive" });
      const source = context.createMediaStreamSource(stream);
      const gain = context.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(context.destination);
      await context.resume?.();
      localMonitorRef.current = { context, source, gain };
      return true;
    },
    [stopLocalMonitoring]
  );
  const cleanupConnection = useCallback(
    () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      stopLocalMonitoring();
      voiceRef.current?.stop();
      stopAllSpeakingMeters();
      voiceRef.current = null;
      for (const id of [...remoteAudioRef.current.keys()])
        removeRemoteAudio(id);
      clientRef.current?.disconnect();
      clientRef.current = null;
    },
    // Stryker disable next-line ArrayDeclaration: both callbacks are stable.
    [removeRemoteAudio, stopAllSpeakingMeters, stopLocalMonitoring]
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
      applyRemoteAudioMute,
      cleanupConnection,
      removeRemoteAudio,
      resetRoomState,
      restoreApplicationAudio,
      setRoom,
      startSpeakingMeter,
      playParticipantJoinedSound
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
  const syncUi = useCallback(
    (state) => {
      clientRef.current?.send("ui", {
        state
      });
    },
    // Stryker disable next-line ArrayDeclaration: the callback closes over a ref only.
    []
  );
  const syncCommand = useCallback(
    (state) => {
      clientRef.current?.send("sync", {
        state
      });
    },
    // Stryker disable next-line ArrayDeclaration: the callback closes over a ref only.
    []
  );
  const openKaraoke = useCallback(
    (songId) => {
      const client = clientRef.current;
      const connectionToken = connectionTokenRef.current;
      return openKaraokeInRoom({
        songId,
        room: roomRef.current,
        client,
        roomApi: api,
        isCurrentConnection: () =>
          connectionToken === connectionTokenRef.current,
        pendingSongCommandRef,
        setTransferStatus
      });
    },
    // Stryker disable next-line ArrayDeclaration: the callback closes over refs only.
    []
  );
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
      setLocalMonitoring,
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
      setLocalMonitoring,
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
