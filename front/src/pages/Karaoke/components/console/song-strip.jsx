import { Mic } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../api/client";
import { translateSaved } from "../../../../i18n/runtime";
import { Stack } from "../../../../theme/ui";
import { formatTime } from "../../utils/format";
import WaveformTimeline from "../waveform-timeline";

export default function SongStrip({ song, currentTime, duration, onSeek }) {
  const { title, artist, performer } = song;
  const [coverFailed, setCoverFailed] = useState(false);
  const coverUrl = song?.id ? api.getSongCoverUrl(song.id) : "";
  const timecodes = [currentTime, duration].map(formatTime);
  return (
    <Stack direction="row" gap={2}>
      <div className="karaoke-song-cover" aria-hidden="true">
        {coverUrl && !coverFailed ? (
          <img
            src={coverUrl}
            alt=""
            decoding="async"
            onError={() => setCoverFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <Mic size={30} />
        )}
      </div>
      <div className="karaoke-player-meta" style={{ width: "10%" }}>
        <strong>{title}</strong>
        <span>{artist || performer || translateSaved("Караоке")}</span>
      </div>
      <span className="mono karaoke-timecode">{timecodes[0]}</span>
      <WaveformTimeline value={currentTime} duration={duration} onChange={onSeek} />
      <span className="mono karaoke-timecode karaoke-timecode-end">{timecodes[1]}</span>
    </Stack>
  );
}
