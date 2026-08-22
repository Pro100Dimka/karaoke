import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { IconButton, Slider, Stack, Typography } from "../theme/ui";
import {
  formatAudioTime,
  normalizeAudioDuration,
  normalizeAudioPosition,
  normalizeAudioVolume,
  toggleAudioPlayback
} from "./audio-player-utils";

const setMedia = (media, key, value) => {
  try {
    media[key] = value;
    return true;
  } catch {
    return false;
  }
};

export function AudioPlayer({ src, className = "", initialDuration = 0 }) {
  const { t } = useI18n();
  const media = useRef(null);
  const rememberedVolume = useRef(1);
  const fallback = normalizeAudioDuration(initialDuration);
  const [state, setState] = useState({
    duration: fallback,
    playing: false,
    position: 0,
    volume: 1
  });
  const update = (value) => setState((current) => ({ ...current, ...value }));

  useEffect(() => {
    media.current?.pause();
    if (media.current) {
      setMedia(media.current, "currentTime", 0);
      try {
        media.current.load();
      } catch {
        // Some test and embedded media implementations do not expose load().
      }
    }
    setState((current) => ({ ...current, duration: fallback, playing: false, position: 0 }));
  }, [fallback, src]);

  const seek = (value) => {
    const position = normalizeAudioPosition(value, state.duration);
    if (setMedia(media.current, "currentTime", position)) update({ position });
  };
  const setVolume = (value) => {
    const volume = normalizeAudioVolume(value);
    if (volume) rememberedVolume.current = volume;
    if (setMedia(media.current, "volume", volume)) update({ volume });
  };

  return (
    <Stack
      direction="row"
      align="center"
      gap="var(--space-2)"
      className={`performance-player ${className}`.trim()}
      sx={{
        padding: "var(--space-2)",
        borderRadius: "var(--radius-pill)",
        background: "var(--color-surface-glass)"
      }}
    >
      <audio
        ref={media}
        preload="metadata"
        src={src}
        onLoadedMetadata={(event) =>
          update({ duration: normalizeAudioDuration(event.currentTarget.duration) || fallback })
        }
        onTimeUpdate={(event) =>
          update({
            position: normalizeAudioPosition(
              event.currentTarget.currentTime,
              normalizeAudioDuration(event.currentTarget.duration) || state.duration
            )
          })
        }
        onPlay={() => update({ playing: true })}
        onPause={() => update({ playing: false })}
        onEnded={(event) => {
          setMedia(event.currentTarget, "currentTime", 0);
          update({ playing: false, position: 0 });
        }}
      />
      <IconButton
        icon={state.playing ? Pause : Play}
        label={t(state.playing ? "audio.pause" : "audio.playRecording")}
        onClick={() => toggleAudioPlayback(media.current)}
      />
      <Stack gap="var(--space-1)" sx={{ flex: 1 }}>
        <Slider
          aria-label={t("audio.recordingPosition")}
          min={0}
          max={state.duration || 0}
          step={0.01}
          value={Math.min(state.position, state.duration || 0)}
          showValue={false}
          onChange={seek}
        />
        <Typography variant="caption" tone="muted">
          {formatAudioTime(state.position)} / {formatAudioTime(state.duration)}
        </Typography>
      </Stack>
      <IconButton
        icon={state.volume ? Volume2 : VolumeX}
        label={t(state.volume ? "audio.mute" : "audio.unmute")}
        onClick={() => setVolume(state.volume ? 0 : rememberedVolume.current)}
      />
      <Slider
        aria-label={t("audio.recordingVolume")}
        min={0}
        max={1}
        step={0.05}
        value={state.volume}
        showValue={false}
        onChange={setVolume}
        controlSx={{ inlineSize: "var(--space-16)" }}
      />
    </Stack>
  );
}
