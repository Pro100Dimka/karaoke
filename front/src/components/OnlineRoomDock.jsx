import {
  Check,
  Copy,
  LogOut,
  Mic,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  MicOff,
  Volume2,
  VolumeX
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import { Card } from "./ui";

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
  const [collapsed, setCollapsed] = useState(false);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const copiedTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    []
  );

  if (!onlineRoom?.room) return null;

  const handleRequestMicrophone = async () => {
    if (requestingMicrophone) return;
    setRequestingMicrophone(true);
    try {
      await onlineRoom.requestMicrophoneAccess();
    } finally {
      setRequestingMicrophone(false);
    }
  };

  const handleCopy = async () => {
    if (!(await copyText(onlineRoom.room.id))) return;
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1600);
  };

  return (
    <>
    <Card
      as="aside"
      className={`online-room-dock ${collapsed ? "is-collapsed" : ""}`}
      aria-hidden={collapsed}
      inert={collapsed ? true : undefined}
      variant="neon"
      tilt={false}
      aria-label="Участники комнаты"
    >
      <div className="online-room-dock-heading">
        <span>Комната · {onlineRoom.room.host ? "ведущий" : "участник"}</span>
        <div className="online-room-dock-code">
          <button
            type="button"
            className="online-room-icon-button"
            onClick={() => setCollapsed(true)}
            title="Скрыть панель комнаты"
            aria-label="Скрыть панель комнаты"
          >
            <PanelLeftClose size={16} />
          </button>
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
          const rawLevel = isSelf
            ? onlineRoom.localSpeakingLevel
            : onlineRoom.speakingLevels[person.id] || 0;
          const microphoneInactive = isSelf
            ? onlineRoom.microphoneMuted || onlineRoom.roomSoundMuted
            : person.micMuted;
          const speakingLevel = microphoneInactive ? 0 : rawLevel;
          const isSpeaking = speakingLevel > 0.08;
          return (
            <div
              className={`online-room-person ${isSelf ? "is-self" : ""} ${isSpeaking ? "is-speaking" : ""}`}
              key={person.id}
              style={{ "--voice-level": speakingLevel }}
            >
              <span className="online-room-person-name">
                <span className="online-room-person-identity">
                  <b>{person.name}</b>
                  {person.role === "host" && <small>ведущий</small>}
                </span>
                <span
                  className="online-room-speaking-meter"
                  aria-label={isSpeaking ? `${person.name} говорит` : `${person.name} молчит`}
                  title={isSpeaking ? "Сейчас говорит" : "Нет голосового сигнала"}
                >
                  {[0.18, 0.38, 0.6, 0.82].map((threshold) => (
                    <i
                      key={threshold}
                      className={speakingLevel >= threshold ? "is-active" : ""}
                    />
                  ))}
                </span>
              </span>
              <div className="online-room-person-actions">
                {isSelf ? (
                  <>
                    <button
                      type="button"
                      className={`online-room-icon-button ${onlineRoom.microphoneMuted ? "is-off" : ""}`}
                      disabled={onlineRoom.roomSoundMuted}
                      onClick={() =>
                        onlineRoom.setMicrophoneMuted(
                          !onlineRoom.microphoneMuted
                        )
                      }
                      title={
                        onlineRoom.microphoneMuted
                          ? "Включить микрофон"
                          : "Выключить микрофон"
                      }
                      aria-label={
                        onlineRoom.microphoneMuted
                          ? "Включить микрофон"
                          : "Выключить микрофон"
                      }
                    >
                      {onlineRoom.microphoneMuted ? (
                        <MicOff size={16} />
                      ) : (
                        <Mic size={16} />
                      )}
                    </button>
                    <button
                      type="button"
                      className={`online-room-icon-button ${onlineRoom.roomSoundMuted ? "is-off" : ""}`}
                      onClick={() =>
                        onlineRoom.setRoomSoundMuted(!onlineRoom.roomSoundMuted)
                      }
                      title={
                        onlineRoom.roomSoundMuted
                          ? "Включить звук приложения"
                          : "Выключить звук приложения"
                      }
                      aria-label={
                        onlineRoom.roomSoundMuted
                          ? "Включить звук приложения"
                          : "Выключить звук приложения"
                      }
                    >
                      {onlineRoom.roomSoundMuted ? (
                        <VolumeX size={16} />
                      ) : (
                        <Volume2 size={16} />
                      )}
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
                    title={
                      isLocallyMuted
                        ? `Включить ${person.name}`
                        : `Не слышать ${person.name}`
                    }
                    aria-label={
                      isLocallyMuted
                        ? `Включить ${person.name}`
                        : `Не слышать ${person.name}`
                    }
                  >
                    {isLocallyMuted ? (
                      <VolumeX size={16} />
                    ) : (
                      <Volume2 size={16} />
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {onlineRoom.voiceError && (
        <div className="online-room-voice-warning">
          <p className="online-room-voice-error">{onlineRoom.voiceError}</p>
          <button
            type="button"
            className="btn btn-sm online-room-permission-button"
            onClick={handleRequestMicrophone}
            disabled={requestingMicrophone}
          >
            <ShieldCheck size={15} />
            {requestingMicrophone ? "Запрашиваем…" : "Разрешить микрофон"}
          </button>
        </div>
      )}
    </Card>
    {collapsed && (
      <button
        type="button"
        className="online-room-restore-button"
        onClick={() => setCollapsed(false)}
        title="Показать панель комнаты"
        aria-label="Показать панель комнаты"
      >
        <PanelLeftOpen size={18} />
        <span>{onlineRoom.room.id}</span>
      </button>
    )}
    </>
  );
}
