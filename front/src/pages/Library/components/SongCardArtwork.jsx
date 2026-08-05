import { Music2 } from "lucide-react";

const WAVE_HEIGHTS = Object.freeze([
  32, 58, 39, 74, 46, 66, 34, 52, 78, 41, 62, 29
]);

export default function SongCardArtwork({ cardIndex }) {
  return (
    <div className="library-song-card-art" aria-hidden="true">
      <Music2 size={26} />
      <div className="library-song-card-wave">
        {WAVE_HEIGHTS.map((height, index) => (
          <i
            key={index}
            style={{
              height: `${height}%`,
              animationDelay: `${(cardIndex + index) * -85}ms`
            }}
          />
        ))}
      </div>
    </div>
  );
}
