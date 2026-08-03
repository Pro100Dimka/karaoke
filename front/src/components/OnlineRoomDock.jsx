import { useState } from "react";
import { Check, Copy, LogOut, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";

async function copyText(value) {
  if (window.electronAPI?.copyText) return window.electronAPI.copyText(value);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

export function OnlineRoomDock() {
  const onlineRoom = useOnlineRoom();
  const [copied, setCopied] = useState(false);
  if (!onlineRoom?.room) return null;

  const handleCopy = async () => {
    if (!(await copyText(onlineRoom.room.id))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside className="online-room-dock" aria-label="Участники комнаты">
      <div className="online-room-dock-heading">
        <span>
          Комната · {onlineRoom.room.host ? "ведущий" : "участник"}
        </span>
        <div className="online-room-dock-code">
          <strong>{onlineRoom.room.id}</strong>
          <button
            type="button"
            className="online-room-icon-button"
            onClick={handleCopy}
            title="Копировать код комнаты"
            aria-label="Копировать код комнаты"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <div className="online-room-dock-people">
        {onlineRoom.participants.map((person) => {
          const isSelf = person.id === onlineRoom.room.selfId;
          const isLocallyMuted = onlineRoom.mutedPeople.has(person.id);
          return (
            <div
              className={`online-room-person ${isSelf ? "is-self" : ""}`}
              key={person.id}
            >
              <span className="online-room-person-name">
                <b>{person.name}</b>
                {person.role === "host" && <small>ведущий</small>}
              </span>
              <div className="online-room-person-actions">
                {isSelf ? (
                  <>
                    <button
                      type="button"
                      className={`online-room-icon-button ${onlineRoom.microphoneMuted ? "is-off" : ""}`}
                      disabled={onlineRoom.roomSoundMuted}
                      onClick={() =>
                        onlineRoom.setMicrophoneMuted(!onlineRoom.microphoneMuted)
                      }
                      title={onlineRoom.microphoneMuted ? "Включить микрофон" : "Выключить микрофон"}
                      aria-label={onlineRoom.microphoneMuted ? "Включить микрофон" : "Выключить микрофон"}
                    >
                      {onlineRoom.microphoneMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>
                    <button
                      type="button"
                      className={`online-room-icon-button ${onlineRoom.roomSoundMuted ? "is-off" : ""}`}
                      onClick={() =>
                        onlineRoom.setRoomSoundMuted(!onlineRoom.roomSoundMuted)
                      }
                      title={onlineRoom.roomSoundMuted ? "Включить звук приложения" : "Выключить звук приложения"}
                      aria-label={onlineRoom.roomSoundMuted ? "Включить звук приложения" : "Выключить звук приложения"}
                    >
                      {onlineRoom.roomSoundMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    </button>
                    <button
                      type="button"
                      className="online-room-icon-button is-leave"
                      onClick={onlineRoom.leaveRoom}
                      title="Выйти из комнаты"
                      aria-label="Выйти из комнаты"
                    >
                      <LogOut size={16} />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={`online-room-icon-button ${isLocallyMuted ? "is-off" : ""}`}
                    onClick={() => onlineRoom.togglePersonMuted(person.id)}
                    title={isLocallyMuted ? `Включить ${person.name}` : `Не слышать ${person.name}`}
                    aria-label={isLocallyMuted ? `Включить ${person.name}` : `Не слышать ${person.name}`}
                  >
                    {isLocallyMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {onlineRoom.voiceError && (
        <p className="online-room-voice-error">{onlineRoom.voiceError}</p>
      )}
    </aside>
  );
}
