import { LogOut, Mic, MicOff, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { Box, IconButton, Popover, Slider, Stack, Typography } from "../theme/ui";
import LiveSignalWaveform from "./LiveSignalWaveform";

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
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeAnchorRef = useRef(null);
  const closeTimerRef = useRef(null);
  const openVolume = () => {
    clearTimeout(closeTimerRef.current);
    setVolumeOpen(true);
  };
  const closeVolumeSoon = () => {
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setVolumeOpen(false), 120);
  };
  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

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
      sx={{ overflow: "visible" }}
    >
      <Stack direction="row" align="center" justify="space-between" gap="var(--space-2)">
        <Typography as="strong" noWrap>
          {person.name}
        </Typography>
        {transferStatus && transferStatus.stage !== "error" && (
          <Typography variant="caption" tone="muted">
            {Math.round(transferStatus.percent || 0)}%
          </Typography>
        )}
        <LiveSignalWaveform
          active={!inactive}
          level={level}
          max={1}
          compact
          ariaLabel={t(key(speaking, "speaking", "silent"), {
            name: person.name
          })}
          title={t(key(speaking, "speakingNow", "noSignal"))}
        />
      </Stack>

      <Stack
        direction="row"
        align="center"
        gap="var(--space-2)"
        sx={{ inlineSize: "auto", overflow: "visible" }}
      >
        {self ? (
          selfActions.map(([icon, label, onClick, disabled]) => (
            <IconButton
              key={label}
              icon={icon}
              label={label}
              iconSize={58}
              sx={{
                minBlockSize: 0
              }}
              variant="contained"
              disabled={disabled}
              onClick={onClick}
            />
          ))
        ) : (
          <>
            <Box
              ref={volumeAnchorRef}
              sx={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                overflow: "visible"
              }}
              onMouseEnter={openVolume}
              onMouseLeave={closeVolumeSoon}
            >
              <IconButton
                icon={isLocallyMuted ? VolumeX : Volume2}
                variant={isLocallyMuted ? "contained" : "outlined"}
                sx={{
                  minBlockSize: 0
                }}
                iconSize={58}
                label={t(key(isLocallyMuted, "enable", "disable"), {
                  name: person.name
                })}
                onClick={() => onTogglePersonMuted(person.id)}
              />

              <Popover
                open={volumeOpen}
                anchorRef={volumeAnchorRef}
                placement="right"
                onClose={() => setVolumeOpen(false)}
                onMouseEnter={openVolume}
                onMouseLeave={closeVolumeSoon}
                style={{
                  padding: "var(--space-4)",
                  boxShadow: "var(--shadow-lg)"
                }}
              >
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={participantVolume}
                  formatValue={(value) => `${Math.round(value * 100)}%`}
                  aria-label={t("room.person.volume", {
                    name: person.name
                  })}
                  sx={{
                    zIndex: 99999
                  }}
                  onChange={(value) => onSetParticipantVolume?.(person.id, value)}
                  controlSx={{
                    inlineSize: "100%"
                  }}
                />
              </Popover>
            </Box>

            <IconButton
              icon={Sparkles}
              variant={effectsEnabled ? "contained" : "outlined"}
              aria-pressed={effectsEnabled}
              label={t(key(effectsEnabled, "effects.disable", "effects.enable"), {
                name: person.name
              })}
              iconSize={50}
              sx={{
                minBlockSize: 0
              }}
              onClick={() => onTogglePersonEffects(person.id)}
            />
          </>
        )}
      </Stack>
    </Stack>
  );
}
