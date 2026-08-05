import image from "../../../assets/karaoke/library-neon-space.png";
import LibraryWaveTerrain from "./LibraryWaveTerrain";

const DECORATIONS = [
  "orb",
  "prism",
  "torus",
  "helix",
  "diamond",
  "satellite",
  "wave",
  "equalizer",
  "comet",
  "portal"
];

export default function LibraryBackdrop() {
  return (
    <div className="library-concert-backdrop" aria-hidden="true">
      <img className="library-neon-space" src={image} alt="" />
      <div className="library-space-decor">
        {DECORATIONS.map((type, index) => (
          <i
            key={type}
            className={`library-space-object library-space-object--${type}`}
            style={{ "--object-index": index }}
          />
        ))}
      </div>
      <LibraryWaveTerrain />
    </div>
  );
}
