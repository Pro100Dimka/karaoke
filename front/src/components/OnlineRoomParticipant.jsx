import { LogOut, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { IconButton } from "./ui";

const SPEAKING_THRESHOLDS = [0.18, 0.38, 0.6, 0.82];

function getMicrophoneLabel(isMuted) {
  return isMuted ? "Включить микрофон" : "Выключить микрофон";
}

function getApplicationSoundLabel(isMuted) {
  return isMuted ? "Включить звук приложения" : "Выключить звук приложения";
}

export default function OnlineRoomParticipant({
  person,
  room,
  localSpeakingLevel,
  speakingLevel = 0,
  microphoneMuted,
  roomSoundMuted,
  isLocallyMuted,
  onLeave,
  onSetMicrophoneMuted,
  onSetRoomSoundMuted,
  onTogglePersonMuted
}) {
  const isSelf = person.id === room.selfId;
  const rawLevel = isSelf ? localSpeakingLevel : speakingLevel;
  const microphoneInactive = isSelf
    ? microphoneMuted || roomSoundMuted
    : person.micMuted;
  const activeSpeakingLevel = microphoneInactive ? 0 : rawLevel;
  const isSpeaking = activeSpeakingLevel > 0.08;
  const microphoneLabel = getMicrophoneLabel(microphoneMuted);
  const applicationSoundLabel = getApplicationSoundLabel(roomSoundMuted);
  const participantSoundLabel = isLocallyMuted
    ? `Включить ${person.name}`
    : `Не слышать ${person.name}`;

  return (
    <div
      className={`online-room-person ${isSelf ? "is-self" : ""} ${isSpeaking ? "is-speaking" : ""}`}
      style={{ "--voice-level": activeSpeakingLevel }}
    >
      <span className="online-room-person-name">
        <span className="online-room-person-identity">
          <b>{person.name}</b>
          {person.role === "host" && <small>ведущий</small>}
        </span>
        <span
          className="online-room-speaking-meter"
          aria-label={
            isSpeaking ? `${person.name} говорит` : `${person.name} молчит`
          }
          title={isSpeaking ? "Сейчас говорит" : "Нет голосового сигнала"}
        >
          {SPEAKING_THRESHOLDS.map((threshold) => (
            <i
              key={threshold}
              className={activeSpeakingLevel >= threshold ? "is-active" : ""}
            />
          ))}
        </span>
      </span>
      <div className="online-room-person-actions">
        {isSelf ? (
          <>
            <IconButton
              unstyled
              icon={microphoneMuted ? MicOff : Mic}
              size={16}
              label={microphoneLabel}
              className={`online-room-icon-button ${microphoneMuted ? "is-off" : ""}`}
              disabled={roomSoundMuted}
              onClick={() => onSetMicrophoneMuted(!microphoneMuted)}
            />
            <IconButton
              unstyled
              icon={roomSoundMuted ? VolumeX : Volume2}
              size={16}
              label={applicationSoundLabel}
              className={`online-room-icon-button ${roomSoundMuted ? "is-off" : ""}`}
              onClick={() => onSetRoomSoundMuted(!roomSoundMuted)}
            />
            <IconButton
              unstyled
              icon={LogOut}
              size={16}
              label="Выйти из комнаты"
              className="online-room-icon-button is-leave"
              onClick={onLeave}
            />
          </>
        ) : (
          <IconButton
            unstyled
            icon={isLocallyMuted ? VolumeX : Volume2}
            size={16}
            label={participantSoundLabel}
            className={`online-room-icon-button ${isLocallyMuted ? "is-off" : ""}`}
            onClick={() => onTogglePersonMuted(person.id)}
          />
        )}
      </div>
    </div>
  );
}
