import lightImage from "../../../../assets/karaoke/library-light-space.webp";
import darkImage from "../../../../assets/karaoke/library-neon-space.png";
import LibraryWaveTerrain from "./wave-terrain";

const BACKGROUNDS = [
  ["dark", darkImage],
  ["light", lightImage]
];

const MUSIC_DECOR = [
  ["record", 4],
  ["microphone", 4],
  ["equalizer", 24],
  ["notes", 6]
];

function MusicObject({ type, parts }) {
  return (
    <i className={`library-music-object library-music-object--${type}`}>
      {Array.from({ length: parts }, (_, part) => (
        <span key={part} style={{ "--part": part }} />
      ))}
    </i>
  );
}

export default function LibraryBackdrop() {
  return (
    <div className="library-concert-backdrop" aria-hidden="true">
      {BACKGROUNDS.map(([theme, src]) => (
        <img
          key={theme}
          className={`library-theme-space library-theme-space--${theme}`}
          src={src}
          alt=""
        />
      ))}
      <div className="library-stage-lights">
        <i />
        <i />
      </div>
      <div className="library-music-decor">
        {MUSIC_DECOR.map(([type, parts]) => (
          <MusicObject key={type} type={type} parts={parts} />
        ))}
      </div>
      <LibraryWaveTerrain />
    </div>
  );
}
