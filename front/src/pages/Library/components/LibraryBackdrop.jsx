import image from "../../../assets/karaoke/library-neon-space.png";
import LibraryWaveTerrain from "./LibraryWaveTerrain";

const MUSICAL_DECOR = [
  { type: "platinum-record", parts: 3 },
  { type: "studio-mic", parts: 4 },
  { type: "equalizer", parts: 12 },
  { type: "vinyl", parts: 3 },
  { type: "headphones", parts: 3 },
  { type: "music-notes", parts: 5 },
  { type: "speaker", parts: 3 },
  { type: "sound-wave", parts: 7 }
];

export default function LibraryBackdrop() {
  return (
    <div className="library-concert-backdrop" aria-hidden="true">
      <img className="library-neon-space" src={image} alt="" />
      <div className="library-music-decor">
        {MUSICAL_DECOR.map(({ type, parts }) => (
          <i key={type} className={`library-music-object library-music-object--${type}`}>
            {Array.from({ length: parts }, (_, index) => (
              <span key={index} style={{ "--part": index }} />
            ))}
          </i>
        ))}
      </div>
      <LibraryWaveTerrain />
    </div>
  );
}
