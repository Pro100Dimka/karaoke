import { Music2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../../../api/client";
import { useRadio } from "../../../../contexts/radio";

const WAVE_BARS = Object.freeze(
  Array.from({ length: 18 }, (_, index) => ({
    idle: 0.16 + ((index * 37 + 19) % 61) / 100,
    speed: 720 + ((index * 113 + 47) % 620)
  }))
);

export default function SongCardArtwork({ cardIndex, song }) {
  const { isPlaying } = useRadio();
  const [coverFailed, setCoverFailed] = useState(false);
  const coverUrl = song?.id ? api.getSongCoverUrl(song.id) : "";

  return (
    <div
      className={["library-song-card-art", isPlaying && "is-radio-reactive"]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      {coverUrl && !coverFailed ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setCoverFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            inset: 0
          }}
        />
      ) : (
        <Music2 size={26} />
      )}
      <div className="library-song-card-wave">
        {WAVE_BARS.map(({ idle, speed }, i) => (
          <i
            key={i}
            style={{
              "--idle-level": idle.toFixed(2),
              "--audio-band": `var(--radio-band-${i}, 0)`,
              animationDelay: `${(cardIndex + i) * -85}ms`,
              animationDuration: `${speed + ((cardIndex * 29) % 240)}ms`
            }}
          />
        ))}
      </div>
    </div>
  );
}
