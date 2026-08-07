import { Music2 } from "lucide-react";
import { useRadio } from "../../../contexts/radio";

const WAVE_HEIGHTS = Object.freeze(
  Array.from({ length: 18 }, () => Math.floor(Math.random() * 61) + 24)
);

export default function SongCardArtwork({ cardIndex }) {
  const { isPlaying } = useRadio();

  return (
    <div
      className={[
        "library-song-card-art",
        isPlaying && "is-radio-reactive"
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      <Music2 size={26} />
      <div className="library-song-card-wave">
        {WAVE_HEIGHTS.map((height, i) => (
          <i
            key={i}
            style={{
              height: `${height}%`,
              "--wave-min": `${Math.max(18, Math.round(height * 0.34)) / height}`,
              "--audio-band": `var(--radio-band-${i}, 0)`,
              animationDelay: `${(cardIndex + i) * -85}ms`,
              animationDuration: `${620 + ((cardIndex * 37 + i * 113) % 680)}ms`
            }}
          />
        ))}
      </div>
    </div>
  );
}
