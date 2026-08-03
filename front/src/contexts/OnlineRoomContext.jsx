import { createContext, useContext, useMemo, useRef, useState } from "react";
import { OnlineRoomClient, OnlineVoiceMesh } from "../services/onlineRoom";

const OnlineRoomContext = createContext(null);

export function OnlineRoomProvider({ children }) {
  const clientRef = useRef(null);
  const voiceRef = useRef(null);
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [mutedPeople, setMutedPeople] = useState(() => new Set());
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [roomSoundMuted, setRoomSoundMuted] = useState(false);
  const [roomUi, setRoomUi] = useState({});

  const value = useMemo(() => ({
    room, participants, mutedPeople, microphoneMuted, roomSoundMuted, roomUi,
    async createRoom(name) {
      const client = new OnlineRoomClient();
      const id = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
      await client.connect({ id, name, host: true });
      clientRef.current = client;
      setRoom({ id, host: true });
      client.onMessage((message) => {
        if (message.type === "room-state") setParticipants(message.participants || []);
        if (message.type === "participant-joined") setParticipants((items) => [...items, message.participant]);
        if (message.type === "participant-left") setParticipants((items) => items.filter((item) => item.id !== message.participantId));
        if (message.type === "ui") setRoomUi(message.state || {});
      });
      return id;
    },
    async leaveRoom() {
      voiceRef.current?.stop();
      clientRef.current?.disconnect();
      clientRef.current = null;
      setRoom(null); setParticipants([]); setMutedPeople(new Set()); setRoomUi({});
    },
    setMicrophoneMuted(value) {
      voiceRef.current?.stream?.getAudioTracks().forEach((track) => { track.enabled = !value; });
      setMicrophoneMuted(value);
    },
    setRoomSoundMuted,
    togglePersonMuted(id) { setMutedPeople((items) => { const next = new Set(items); next.has(id) ? next.delete(id) : next.add(id); return next; }); },
    getClient: () => clientRef.current,
    syncUi(state) { clientRef.current?.send("ui", { state }); },
    getVoice: () => voiceRef.current || (voiceRef.current = new OnlineVoiceMesh(clientRef.current)),
  }), [microphoneMuted, mutedPeople, participants, room, roomSoundMuted, roomUi]);
  return <OnlineRoomContext.Provider value={value}>{children}</OnlineRoomContext.Provider>;
}

export function useOnlineRoom() { return useContext(OnlineRoomContext); }
