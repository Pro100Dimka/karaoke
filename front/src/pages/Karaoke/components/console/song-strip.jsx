import { Mic } from "lucide-react";
import { formatTime } from "../../utils/format";
import WaveformTimeline from "../WaveformTimeline";

export default function SongStrip({ song, currentTime, duration, onSeek }) {
  const { title, artist, performer } = song;
  const timecodes = [currentTime, duration].map(formatTime);
  return (
    <div className="karaoke-song-strip">
      <div className="karaoke-song-cover" aria-hidden="true">
        <Mic size={30} />
      </div>
      <div className="karaoke-player-meta">
        <strong>{title}</strong>
        <span>{artist || performer || "Караоке"}</span>
      </div>
      <span className="mono karaoke-timecode">{timecodes[0]}</span>
      <WaveformTimeline
        value={currentTime}
        duration={duration}
        onChange={onSeek}
      />
      <span className="mono karaoke-timecode karaoke-timecode-end">
        {timecodes[1]}
      </span>
    </div>
  );
}
