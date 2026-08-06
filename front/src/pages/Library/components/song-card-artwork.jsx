import { Music2 } from "lucide-react";

const WAVE_HEIGHTS = Object.freeze(
  Array.from({ length: 18 }, () => Math.floor(Math.random() * 61) + 24)
);

export default function SongCardArtwork({ cardIndex }) {
  return (
    <div className="library-song-card-art" aria-hidden="true">
      <Music2 size={26} />
      <div className="library-song-card-wave">
        {WAVE_HEIGHTS.map((height, i) => (
          <i
            key={i}
            style={{
              height: `${height}%`,
              animationDelay: `${(cardIndex + i) * -85}ms`
            }}
          />
        ))}
      </div>
    </div>
  );
}
