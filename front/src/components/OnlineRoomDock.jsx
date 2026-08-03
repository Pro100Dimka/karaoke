import { Copy, LogOut, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";

export function OnlineRoomDock() {
  const room = useOnlineRoom();
  if (!room?.room) return null;
  const copy = () =>
    window.electronAPI?.copyText?.(room.room.id) ||
    navigator.clipboard?.writeText(room.room.id);
  return (
    <aside className="online-room-dock" aria-label="Совместное исполнение">
      <header>
        <small>КОМНАТА · {room.room.host ? "ВЕДУЩИЙ" : "УЧАСТНИК"}</small>
      </header>
      <div className="online-room-dock-code">
        <strong>{room.room.id}</strong>
        <button className="btn btn-ghost" onClick={copy} title="Копировать код">
          <Copy size={15} />
        </button>
      </div>
      <div className="online-room-dock-people">
        {room.participants.map((person) => {
          const isSelf =
            person.id ===
            room.participants.find((item) => item.name === person.name)?.id;
          return (
            <div className="online-room-person" key={person.id}>
              <span>
                {person.name}
                {person.role === "host" ? " · ведущий" : ""}
              </span>
              <div>
                {isSelf ? (
                  <>
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        room.setMicrophoneMuted(!room.microphoneMuted)
                      }
                    >
                      {room.microphoneMuted ? (
                        <MicOff size={14} />
                      ) : (
                        <Mic size={14} />
                      )}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() =>
                        room.setRoomSoundMuted(!room.roomSoundMuted)
                      }
                    >
                      {room.roomSoundMuted ? (
                        <VolumeX size={15} />
                      ) : (
                        <Volume2 size={15} />
                      )}
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => room.leaveRoom()}
                      title="Выйти"
                    >
                      <LogOut size={15} />
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-ghost"
                    onClick={() => room.togglePersonMuted(person.id)}
                  >
                    <VolumeX size={15} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
