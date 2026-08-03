import { Copy, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";

export function OnlineRoomDock() {
  const room = useOnlineRoom();
  if (!room?.room) return null;
  const copy = () => window.electronAPI?.copyText?.(room.room.id) || navigator.clipboard?.writeText(room.room.id);
  return <aside className="online-room-dock" aria-label="Совместное исполнение">
    <small>КОМНАТА · {room.room.host ? "ВЕДУЩИЙ" : "УЧАСТНИК"}</small>
    <strong>{room.room.id}</strong><button type="button" className="btn btn-ghost" onClick={copy}><Copy size={15} /></button>
    <div>{room.participants.map((person) => <span key={person.id}>{person.name}</span>)}</div>
    <button type="button" className="btn btn-ghost" onClick={() => room.setMicrophoneMuted(!room.microphoneMuted)}>{room.microphoneMuted ? <MicOff size={15} /> : <Mic size={15} />}</button>
    <button type="button" className="btn btn-ghost" onClick={() => room.setRoomSoundMuted(!room.roomSoundMuted)}>{room.roomSoundMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
    <button type="button" className="btn btn-ghost" onClick={() => room.leaveRoom()}>Выйти</button>
  </aside>;
}
