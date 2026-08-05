const PIXEL_COUNT = 34;
const EQUALIZER_BAR_COUNT = 28;

export default function LibraryBackdrop({ image }) {
  return (
    <div className="library-concert-backdrop" aria-hidden="true">
      <img className="library-neon-space" src={image} alt="" />
      <i className="library-bg-vinyl library-bg-vinyl--one" />
      <i className="library-bg-vinyl library-bg-vinyl--two" />
      <i className="library-bg-cassette library-bg-cassette--one">
        <b />
        <b />
      </i>
      <i className="library-bg-cassette library-bg-cassette--two">
        <b />
        <b />
      </i>
      <i className="library-bg-cube library-bg-cube--one" />
      <i className="library-bg-cube library-bg-cube--two" />
      <i className="library-bg-sphere library-bg-sphere--one" />
      <i className="library-bg-sphere library-bg-sphere--two" />
      <i className="library-bg-ring library-bg-ring--one" />
      <i className="library-bg-ring library-bg-ring--two" />
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
