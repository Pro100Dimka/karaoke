import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { IconButton } from "../theme/ui";
import {
  formatAudioTime,
  normalizeAudioDuration,
  normalizeAudioPosition,
  normalizeAudioVolume,
  toggleAudioPlayback
} from "./audio-player-utils";
import { RangeInput } from "./fields";

export function AudioPlayer({ src, className = "", initialDuration = 0 }) {
  const { t } = useI18n();
  const audioRef = useRef(null);
  const previousVolumeRef = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const fallbackDuration = normalizeAudioDuration(initialDuration);
  const [duration, setDuration] = useState(fallbackDuration);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    audio.pause();
    try {
      audio.currentTime = 0;
      audio.load();
    } catch {
      // The previous media resource may already be detached.
    }
    setPlaying(false);
    setPosition(0);
    setDuration(fallbackDuration);
  }, [fallbackDuration, src]);

  const toggle = async () => {
    await toggleAudioPlayback(audioRef.current);
  };
  const seek = (value) => {
    const positionValue = normalizeAudioPosition(value, duration);
    try {
      audioRef.current.currentTime = positionValue;
    } catch {
      return;
    }
    setPosition(positionValue);
  };
  const changeVolume = (value) => {
    const volumeValue = normalizeAudioVolume(value);
    if (volumeValue > 0) previousVolumeRef.current = volumeValue;
    try {
      audioRef.current.volume = volumeValue;
    } catch {
      return;
    }
    setVolume(volumeValue);
  };

  const toggleMuted = () => {
    changeVolume(volume > 0 ? 0 : previousVolumeRef.current);
  };

  return (
    <div className={`performance-player ${className}`}>
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onLoadedMetadata={(event) => {
          const mediaDuration = normalizeAudioDuration(event.currentTarget.duration);
          setDuration(mediaDuration || fallbackDuration);
        }}
        onTimeUpdate={(event) =>
          setPosition(
            normalizeAudioPosition(
              event.currentTarget.currentTime,
              normalizeAudioDuration(event.currentTarget.duration) || duration
            )
          )
        }
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => {
          try {
            event.currentTarget.currentTime = 0;
          } catch {
            // Media can be detached while the ended event is being delivered.
          }
          setPlaying(false);
          setPosition(0);
        }}
      />
      <IconButton
        unstyled
        className="performance-player-play"
        icon={playing ? Pause : Play}
        iconSize={18}
        label={t(playing ? "audio.pause" : "audio.playRecording")}
        onClick={toggle}
      />
      <div className="performance-player-track u-muted-xs">
        <RangeInput
          aria-label={t("audio.recordingPosition")}
          min="0"
          max={duration || 0}
          step="0.01"
          value={Math.min(position, duration || 0)}
          onChange={seek}
        />
        <span>
          {formatAudioTime(position)} / {formatAudioTime(duration)}
        </span>
      </div>
      <div className="performance-player-volume">
        <IconButton
          unstyled
          icon={volume ? Volume2 : VolumeX}
          iconSize={16}
          label={t(volume ? "audio.mute" : "audio.unmute")}
          onClick={toggleMuted}
        />
        <RangeInput
          aria-label={t("audio.recordingVolume")}
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={changeVolume}
        />
      </div>
    </div>
  );
}
