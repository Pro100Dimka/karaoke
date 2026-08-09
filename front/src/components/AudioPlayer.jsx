import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  formatAudioTime,
  normalizeAudioDuration,
  normalizeAudioPosition,
  normalizeAudioVolume,
  toggleAudioPlayback
} from "./audio-player-utils";
import { RangeInput } from "./fields";
import { IconButton } from "./ui";

export function AudioPlayer({ src, className = "", initialDuration = 0 }) {
  const audioRef = useRef(null);
  const previousVolumeRef = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const fallbackDuration = normalizeAudioDuration(initialDuration);
  const [duration, setDuration] = useState(fallbackDuration);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) {
      try {
        audio.currentTime = 0;
        audio.load();
      } catch {
        // The previous media resource may already be detached.
      }
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
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = positionValue;
      } catch {
        return;
      }
    }
    setPosition(positionValue);
  };
  const changeVolume = (value) => {
    const volumeValue = normalizeAudioVolume(value);
    if (volumeValue > 0) previousVolumeRef.current = volumeValue;
    if (audioRef.current) {
      try {
        audioRef.current.volume = volumeValue;
      } catch {
        return;
      }
    }
    setVolume(volumeValue);
  };

  const toggleMuted = () => {
    changeVolume(volume > 0 ? 0 : previousVolumeRef.current || 1);
  };

  return (
    <div className={`performance-player ${className}`}>
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onLoadedMetadata={(event) => {
          const mediaDuration = normalizeAudioDuration(
            event.currentTarget.duration
          );
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
        size={18}
        label={playing ? "Пауза" : "Воспроизвести запись"}
        onClick={toggle}
      />
      <div className="performance-player-track u-muted-xs">
        <RangeInput
          aria-label="Позиция записи"
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
          size={16}
          label={volume ? "Выключить звук" : "Включить звук"}
          onClick={toggleMuted}
        />
        <RangeInput
          aria-label="Громкость записи"
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
