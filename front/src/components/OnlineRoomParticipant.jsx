import { LogOut, Mic, MicOff, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../i18n";
import { IconButton } from "./ui";

const SPEAKING_THRESHOLDS = [0.18, 0.38, 0.6, 0.82];

export default function OnlineRoomParticipant({
  person,
  room,
  localSpeakingLevel,
  speakingLevel = 0,
  microphoneMuted,
  roomSoundMuted,
  isLocallyMuted,
  effectsEnabled,
  onLeave,
  onSetMicrophoneMuted,
  onSetRoomSoundMuted,
  onTogglePersonMuted,
  onTogglePersonEffects
}) {
  const { t } = useI18n();
  const isSelf = person.id === room.selfId;
  const rawLevel = isSelf ? localSpeakingLevel : speakingLevel;
  const microphoneInactive = isSelf
    ? microphoneMuted || roomSoundMuted
    : person.micMuted;
  const activeSpeakingLevel = microphoneInactive ? 0 : rawLevel;
  const isSpeaking = activeSpeakingLevel > 0.08;
  const microphoneLabel = t(
    microphoneMuted ? "room.microphone.enable" : "room.microphone.disable"
  );
  const applicationSoundLabel = t(
    roomSoundMuted ? "room.sound.enable" : "room.sound.disable"
  );
  const participantSoundLabel = isLocallyMuted
    ? t("room.person.enable", { name: person.name })
    : t("room.person.disable", { name: person.name });

  return (
    <div
      className={`online-room-person ${isSelf ? "is-self" : ""} ${isSpeaking ? "is-speaking" : ""}`}
      style={{ "--voice-level": activeSpeakingLevel }}
    >
      <span className="online-room-person-name">
        <span className="online-room-person-identity">
          <b>{person.name}</b>
          {person.role === "host" && <small>{t("room.role.host")}</small>}
        </span>
        <span
          className="online-room-speaking-meter"
          aria-label={t(
            isSpeaking ? "room.person.speaking" : "room.person.silent",
            {
              name: person.name
            }
          )}
          title={t(
            isSpeaking ? "room.person.speakingNow" : "room.person.noSignal"
          )}
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
              label={t("room.leave")}
              className="online-room-icon-button is-leave"
              onClick={onLeave}
            />
          </>
        ) : (
          <>
            <IconButton
              unstyled
              icon={Sparkles}
              size={16}
              label={t(
                effectsEnabled
                  ? "room.person.effects.disable"
                  : "room.person.effects.enable",
                { name: person.name }
              )}
              aria-pressed={effectsEnabled}
              className={`online-room-icon-button ${effectsEnabled ? "is-active" : ""}`}
              onClick={() => onTogglePersonEffects(person.id)}
            />
            <IconButton
              unstyled
              icon={isLocallyMuted ? VolumeX : Volume2}
              size={16}
              label={participantSoundLabel}
              className={`online-room-icon-button ${isLocallyMuted ? "is-off" : ""}`}
              onClick={() => onTogglePersonMuted(person.id)}
            />
          </>
        )}
      </div>
    </div>
  );
}
