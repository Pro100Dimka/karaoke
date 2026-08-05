import darkImage from "../../../assets/karaoke/library-neon-space.png";
import lightImage from "../../../assets/karaoke/library-light-space.webp";
import LibraryWaveTerrain from "./LibraryWaveTerrain";

const MUSIC_DECOR = [
  { type: "record", parts: 4 },
  { type: "microphone", parts: 4 },
  { type: "equalizer", parts: 24 },
  { type: "notes", parts: 6 }
];

export default function LibraryBackdrop() {
  return (
    <div className="library-concert-backdrop" aria-hidden="true">
      <img className="library-theme-space library-theme-space--dark" src={darkImage} alt="" />
      <img className="library-theme-space library-theme-space--light" src={lightImage} alt="" />
      <div className="library-stage-lights">
        <i />
        <i />
      </div>
      <div className="library-music-decor">
        {MUSIC_DECOR.map(({ type, parts }) => (
          <i
            key={type}
            className={`library-music-object library-music-object--${type}`}
          >
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
