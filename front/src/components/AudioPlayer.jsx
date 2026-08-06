import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { RangeInput } from "./fields";
import { IconButton } from "./ui";
import {
  formatAudioTime,
  normalizeAudioDuration,
  normalizeAudioPosition,
  normalizeAudioVolume,
  toggleAudioPlayback
} from "./audio-player-utils";

export function AudioPlayer({ src, className = "" }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const toggle = async () => {
    await toggleAudioPlayback(audioRef.current);
  };
  const seek = (value) => {
    const positionValue = normalizeAudioPosition(value, duration);
    if (audioRef.current) audioRef.current.currentTime = positionValue;
    setPosition(positionValue);
  };
  const changeVolume = (value) => {
    const volumeValue = normalizeAudioVolume(value);
    if (audioRef.current) audioRef.current.volume = volumeValue;
    setVolume(volumeValue);
  };

  return (
    <div className={`performance-player ${className}`}>
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        onLoadedMetadata={(event) =>
          setDuration(normalizeAudioDuration(event.currentTarget.duration))
        }
        onTimeUpdate={(event) =>
          setPosition(
            normalizeAudioPosition(event.currentTarget.currentTime, duration)
          )
        }
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
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
      <div className="performance-player-track">
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
          onClick={() => changeVolume(volume ? 0 : 1)}
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
