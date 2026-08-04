import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return "00:00";
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
};

export function AudioPlayer({ src, className = "" }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };
  const seek = (value) => {
    const positionValue = Number(value);
    if (audioRef.current) audioRef.current.currentTime = positionValue;
    setPosition(positionValue);
  };
  const changeVolume = (value) => {
    const volumeValue = Number(value);
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
          setDuration(event.currentTarget.duration || 0)
        }
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosition(0);
        }}
      />
      <button
        className="performance-player-play"
        type="button"
        onClick={toggle}
      >
        {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
      </button>
      <div className="performance-player-track">
        <input
          aria-label="Позиция записи"
          type="range"
          min="0"
          max={duration || 0}
          step="0.01"
          value={Math.min(position, duration || 0)}
          onChange={(event) => seek(event.target.value)}
        />
        <span>
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>
      <div className="performance-player-volume">
        <button type="button" onClick={() => changeVolume(volume ? 0 : 1)}>
          {volume ? <Volume2 size={16} /> : <VolumeX size={16} />}
        </button>
        <input
          aria-label="Громкость записи"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(event) => changeVolume(event.target.value)}
        />
      </div>
    </div>
  );
}
