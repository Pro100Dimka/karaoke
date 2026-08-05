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
  normalizeRoomId,
  OnlineRoomClient,
  OnlineVoiceMesh
} from "../services/onlineRoom";
import { getErrorMessage } from "../utils/errors";

const OnlineRoomContext = createContext(null);

function upsertParticipant(items, participant) {
  if (!participant?.id) return items;
  const index = items.findIndex((item) => item.id === participant.id);
  if (index < 0) return [...items, participant];
  const next = [...items];
  next[index] = { ...next[index], ...participant };
  return next;
}

export function OnlineRoomProvider({ children }) {
  const clientRef = useRef(null);
  const unsubscribeRef = useRef(null);
  const voiceRef = useRef(null);
  const remoteAudioRef = useRef(new Map());
  const appAudioStateRef = useRef(new Map());
  const previousMicMutedRef = useRef(false);
  const roomRef = useRef(null);
  const mutedPeopleRef = useRef(new Set());
  const roomSoundMutedRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const pendingSongCommandRef = useRef(null);

  const [room, setRoomState] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [mutedPeople, setMutedPeople] = useState(() => new Set());
  const [microphoneMuted, setMicrophoneMutedState] = useState(false);
  const [roomSoundMuted, setRoomSoundMutedState] = useState(false);
  const [roomUi, setRoomUi] = useState({});
  const [roomCommand, setRoomCommand] = useState(null);
  const [voiceError, setVoiceError] = useState("");

  const setRoom = useCallback((next) => {
    roomRef.current = next;
    setRoomState(next);
  }, []);

  const removeRemoteAudio = useCallback((participantId) => {
    const audio = remoteAudioRef.current.get(participantId);
    if (!audio) return;
    audio.pause();
    audio.srcObject = null;
    audio.remove();
    remoteAudioRef.current.delete(participantId);
  }, []);

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
    voiceRef.current = null;
    for (const id of [...remoteAudioRef.current.keys()]) removeRemoteAudio(id);
    clientRef.current?.disconnect();
    clientRef.current = null;
  }, [removeRemoteAudio]);

  const setMicrophoneMuted = useCallback((muted, broadcast = true) => {
    const next = Boolean(muted);
    voiceRef.current?.setMicrophoneMuted(next);
    setMicrophoneMutedState(next);
    if (broadcast) clientRef.current?.send("presence", { micMuted: next });
  }, []);

  const restoreApplicationAudio = useCallback(() => {
    for (const [audio, wasMuted] of appAudioStateRef.current) {
      if (audio.isConnected) audio.muted = wasMuted;
    }
    appAudioStateRef.current.clear();
  }, []);

  const setRoomSoundMuted = useCallback(
    (muted) => {
      const next = Boolean(muted);
      if (next === roomSoundMutedRef.current) return;
      roomSoundMutedRef.current = next;
      setRoomSoundMutedState(next);

      if (next) {
        previousMicMutedRef.current = microphoneMuted;
        setMicrophoneMuted(true);
        document.querySelectorAll("audio").forEach((audio) => {
          if (audio.dataset.onlineRoomParticipant) return;
          appAudioStateRef.current.set(audio, audio.muted);
          audio.muted = true;
        });
      } else {
        restoreApplicationAudio();
        setMicrophoneMuted(previousMicMutedRef.current);
      }
      applyRemoteAudioMute();
    },
    [
      applyRemoteAudioMute,
      microphoneMuted,
      restoreApplicationAudio,
      setMicrophoneMuted
    ]
  );

  const leaveRoom = useCallback(async () => {
    intentionalDisconnectRef.current = true;
    restoreApplicationAudio();
    cleanupConnection();
    setRoom(null);
    setParticipants([]);
    mutedPeopleRef.current = new Set();
    setMutedPeople(new Set());
    roomSoundMutedRef.current = false;
    setRoomSoundMutedState(false);
    setMicrophoneMutedState(false);
    setRoomUi({});
    setRoomCommand(null);
    setVoiceError("");
    intentionalDisconnectRef.current = false;
  }, [cleanupConnection, restoreApplicationAudio, setRoom]);

  const connect = useCallback(
    async ({ id, name, host }) => {
      intentionalDisconnectRef.current = true;
      cleanupConnection();
      intentionalDisconnectRef.current = false;
      setVoiceError("");

      const client = new OnlineRoomClient();
      const voice = new OnlineVoiceMesh(client);
      clientRef.current = client;
      voiceRef.current = voice;

      voice.onRemoteStream = (participantId, stream) => {
        removeRemoteAudio(participantId);
        const audio = document.createElement("audio");
        audio.dataset.onlineRoomParticipant = participantId;
        audio.autoplay = true;
        audio.playsInline = true;
        audio.srcObject = stream;
        audio.style.display = "none";
        document.body.append(audio);
        remoteAudioRef.current.set(participantId, audio);
        applyRemoteAudioMute();
        audio.play().catch(() => {
          setVoiceError(
            "Нажмите в любом месте приложения, чтобы разрешить звук комнаты."
          );
        });
      };
      voice.onPeerClosed = removeRemoteAudio;
      voice.onFile = async (_participantId, blob, metadata) => {
        if (metadata.kind !== "song-package" || !metadata.songId) return;
        try {
          setVoiceError("Импортируем песню в локальную библиотеку…");
          await api.importSongPackage(blob, metadata.filename);
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
          setVoiceError(
            `Не удалось импортировать песню: ${getErrorMessage(error)}`
          );
        }
      };

      unsubscribeRef.current = client.onMessage((message) => {
        if (message.type === "room-state") {
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
          return;
        }
        if (message.type === "participant-joined") {
          setParticipants((items) =>
            upsertParticipant(items, message.participant)
          );
          voice.invite(message.participant?.id).catch(() => {});
          return;
        }
        if (message.type === "participant-updated") {
          setParticipants((items) =>
            upsertParticipant(items, message.participant)
          );
          return;
        }
        if (message.type === "self-updated" && message.self) {
          setRoom({
            ...(roomRef.current || {}),
            selfId: message.self.id,
            host: message.self.role === "host",
            role: message.self.role
          });
          return;
        }
        if (message.type === "participant-left") {
          setParticipants((items) =>
            items.filter((item) => item.id !== message.participantId)
          );
          voice.removePeer(message.participantId);
          return;
        }
        if (message.type === "signal") {
          voice.accept(message.fromId, message.signal).catch(() => {});
          return;
        }
        if (message.type === "ui") {
          setRoomUi((current) => ({
            ...current,
            ...(message.state || {}),
            __eventId: `${Date.now()}-${Math.random()}`
          }));
          return;
        }
        if (message.type === "sync") {
          const command = message.state || {};
          if (
            command.type === "song-request" &&
            roomRef.current?.host &&
            command.requesterId &&
            command.songId
          ) {
            api
              .exportSongPackage(command.songId)
              .then((blob) => {
                setVoiceError(`Передаём песню участнику…`);
                return voice.sendFile(command.requesterId, blob, {
                  kind: "song-package",
                  songId: command.songId,
                  filename: `${command.songId}.karaoke.zip`
                });
              })
              .then(() => setVoiceError(""))
              .catch((error) => {
                setVoiceError(
                  `Не удалось передать песню: ${getErrorMessage(error)}`
                );
              });
            return;
          }
          if (command.type === "open-karaoke" && !roomRef.current?.host) {
            api
              .getSong(command.songId)
              .then(() => {
                setRoomCommand({
                  ...command,
                  __eventId: `${message.sentAt || Date.now()}-${Math.random()}`
                });
              })
              .catch(() => {
                pendingSongCommandRef.current = command;
                setVoiceError("Получаем песню от ведущего…");
                client.send("sync", {
                  state: {
                    type: "song-request",
                    songId: command.songId,
                    requesterId: roomRef.current?.selfId
                  }
                });
              });
            return;
          }
          setRoomCommand({
            ...command,
            __eventId: `${message.sentAt || Date.now()}-${Math.random()}`
          });
          return;
        }
        if (
          message.type === "connection-closed" &&
          !intentionalDisconnectRef.current
        ) {
          setVoiceError("Соединение с комнатой потеряно.");
          cleanupConnection();
          setRoom(null);
          setParticipants([]);
        }
      });

      try {
        const normalizedId = await client.connect({ id, name, host });
        voice
          .start()
          .then(() => {
            voice.setMicrophoneMuted(
              microphoneMuted || roomSoundMutedRef.current
            );
            client.send("presence", {
              micMuted: microphoneMuted || roomSoundMutedRef.current
            });
          })
          .catch((error) => {
            setVoiceError(
              `Комната подключена без голоса: ${error?.message || "нет доступа к микрофону"}`
            );
          });
        return normalizedId;
      } catch (error) {
        cleanupConnection();
        throw error;
      }
    },
    [
      applyRemoteAudioMute,
      cleanupConnection,
      microphoneMuted,
      removeRemoteAudio,
      setRoom
    ]
  );

  useEffect(() => () => cleanupConnection(), [cleanupConnection]);

  useEffect(() => {
    if (!roomSoundMuted) return undefined;
    const muteApplicationAudio = (root) => {
      const audioElements = [
        ...(root instanceof HTMLAudioElement ? [root] : []),
        ...(root.querySelectorAll?.("audio") || [])
      ];
      audioElements.forEach((audio) => {
        if (audio.dataset.onlineRoomParticipant) return;
        if (!appAudioStateRef.current.has(audio)) {
          appAudioStateRef.current.set(audio, audio.muted);
        }
        audio.muted = true;
      });
    };
    muteApplicationAudio(document);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) muteApplicationAudio(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [roomSoundMuted]);

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
      createRoom(name) {
        const id = crypto
          .randomUUID()
          .replaceAll("-", "")
          .slice(0, 8)
          .toUpperCase();
        return connect({ id, name, host: true });
      },
      joinRoom(id, name) {
        return connect({ id, name, host: false });
      },
      leaveRoom,
      setMicrophoneMuted,
      setRoomSoundMuted,
      togglePersonMuted(id) {
        setMutedPeople((items) => {
          const next = new Set(items);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          mutedPeopleRef.current = next;
          queueMicrotask(applyRemoteAudioMute);
          return next;
        });
      },
      syncUi(state) {
        clientRef.current?.send("ui", { state });
      },
      syncCommand(state) {
        clientRef.current?.send("sync", { state });
      },
      async openKaraoke(songId) {
        const command = { type: "open-karaoke", songId };
        if (!room || room.host) {
          clientRef.current?.send("sync", { state: command });
          return true;
        }
        try {
          await api.getSong(songId);
          clientRef.current?.send("sync", { state: command });
          return true;
        } catch {
          pendingSongCommandRef.current = {
            ...command,
            __originatedHere: true
          };
          setVoiceError("Получаем песню от ведущего…");
          clientRef.current?.send("sync", {
            state: {
              type: "song-request",
              songId,
              requesterId: room.selfId
            }
          });
          return false;
        }
      }
    }),
    [
      applyRemoteAudioMute,
      connect,
      leaveRoom,
      microphoneMuted,
      mutedPeople,
      participants,
      room,
      roomCommand,
      roomSoundMuted,
      roomUi,
      setMicrophoneMuted,
      setRoomSoundMuted,
      voiceError
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
