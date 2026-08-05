import LibraryWaveTerrain from "./LibraryWaveTerrain";

const PIXEL_COUNT = 34;
const EQUALIZER_BAR_COUNT = 28;

const BACKGROUND_GROUPS = [
  ["library-bg-vinyl--one", "library-bg-vinyl--two"],
  ["library-bg-cassette--one", "library-bg-cassette--two"],
  ["library-bg-cube--one", "library-bg-cube--two"],
  ["library-bg-sphere--one", "library-bg-sphere--two"],
  ["library-bg-ring--one", "library-bg-ring--two"]
];

export default function LibraryBackdrop() {
  return (
    <div className="library-concert-backdrop" aria-hidden="true">
      {/* <img className="library-neon-space" src={image} alt="" /> */}
      {BACKGROUND_GROUPS.map((group, gIndex) =>
        group.map((cls, i) => (
          <i key={`${gIndex}-${i}`} className={`library-bg ${cls}`} />
        ))
      )}
      <LibraryWaveTerrain />
      <div className="library-bg-notes">♪ ♫ ♪ ♬</div>
      <div className="library-bg-pixel-rain">
        {Array.from({ length: PIXEL_COUNT }, (_, index) => (
          <i key={index} style={{ "--n": index }} />
        ))}
      </div>
      <div className="library-bg-eq">
        {Array.from({ length: EQUALIZER_BAR_COUNT }, (_, index) => (
          <i key={index} style={{ animationDelay: `${index * -110}ms` }} />
        ))}
      </div>
    </div>
  );
}
