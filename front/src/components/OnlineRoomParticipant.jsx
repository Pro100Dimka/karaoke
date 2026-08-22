import { LogOut, Mic, MicOff, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../i18n";
import { Box, IconButton, Slider, Stack, Typography } from "../theme/ui";

const LEVELS = [0.18, 0.38, 0.6, 0.82];
const key = (enabled, on, off) => `room.person.${enabled ? on : off}`;

export default function OnlineRoomParticipant({
  person,
  room,
  localSpeakingLevel = 0,
  speakingLevel = 0,
  microphoneMuted = false,
  roomSoundMuted = false,
  isLocallyMuted = false,
  effectsEnabled = false,
  participantVolume = 1,
  transferStatus,
  onLeave,
  onSetMicrophoneMuted,
  onSetRoomSoundMuted,
  onSetParticipantVolume,
  onTogglePersonMuted,
  onTogglePersonEffects
}) {
  const { t } = useI18n();
  const self = person.id === room.selfId;
  const inactive = self ? microphoneMuted || roomSoundMuted : person.micMuted;
  const level = inactive ? 0 : self ? localSpeakingLevel : speakingLevel;
  const speaking = level > 0.08;
  const selfActions = [
    [
      microphoneMuted ? MicOff : Mic,
      t(microphoneMuted ? "room.microphone.enable" : "room.microphone.disable"),
      () => onSetMicrophoneMuted(!microphoneMuted),
      roomSoundMuted
    ],
    [
      roomSoundMuted ? VolumeX : Volume2,
      t(roomSoundMuted ? "room.sound.enable" : "room.sound.disable"),
      () => onSetRoomSoundMuted(!roomSoundMuted)
    ],
    [LogOut, t("room.leave"), onLeave]
  ];
  return (
    <Stack
      direction="row"
      align="center"
      justify="space-between"
      gap="var(--space-3)"
      data-self={self || undefined}
      data-speaking={speaking || undefined}
      sx={{
        padding: "var(--space-3)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface-glass)"
      }}
    >
      <Stack direction="row" align="center" gap="var(--space-2)" sx={{ minInlineSize: 0 }}>
        <Typography as="strong" noWrap>
          {person.name}
        </Typography>
        {person.role === "host" && (
          <Typography variant="caption" tone="muted">
            {t("room.role.host")}
          </Typography>
        )}
        {transferStatus && transferStatus.stage !== "error" && (
          <Typography variant="caption" tone="muted">
            {Math.round(transferStatus.percent || 0)}%
          </Typography>
        )}
        <Stack
          as="span"
          direction="row"
          gap="var(--space-1)"
          aria-label={t(key(speaking, "speaking", "silent"), { name: person.name })}
          title={t(key(speaking, "speakingNow", "noSignal"))}
        >
          {LEVELS.map((threshold) => (
            <Box
              as="i"
              key={threshold}
              data-active={level >= threshold || undefined}
              sx={{
                inlineSize: "var(--space-1)",
                blockSize: "var(--space-3)",
                borderRadius: "var(--radius-pill)",
                background: level >= threshold ? "var(--color-primary)" : "var(--color-border)"
              }}
            />
          ))}
        </Stack>
      </Stack>
      <Stack direction="row" align="center" gap="var(--space-2)" sx={{ inlineSize: "auto" }}>
        {self ? (
          selfActions.map(([icon, label, onClick, disabled]) => (
            <IconButton
              key={label}
              icon={icon}
              label={label}
              variant="outline"
              disabled={disabled}
              onClick={onClick}
            />
          ))
        ) : (
          <>
            <IconButton
              icon={Sparkles}
              variant="outline"
              aria-pressed={effectsEnabled}
              label={t(key(effectsEnabled, "effects.disable", "effects.enable"), {
                name: person.name
              })}
              onClick={() => onTogglePersonEffects(person.id)}
            />
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={participantVolume}
              formatValue={(value) => `${Math.round(value * 100)}%`}
              aria-label={t("room.person.volume", { name: person.name })}
              onChange={(value) => onSetParticipantVolume?.(person.id, value)}
              controlSx={{ inlineSize: "var(--space-24)" }}
            />
            <IconButton
              icon={isLocallyMuted ? VolumeX : Volume2}
              variant="outline"
              label={t(key(isLocallyMuted, "enable", "disable"), { name: person.name })}
              onClick={() => onTogglePersonMuted(person.id)}
            />
          </>
        )}
      </Stack>
    </Stack>
  );
}
