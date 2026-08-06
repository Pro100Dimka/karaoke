const PARTICLE_COLORS = ["#ff5c99", "#ff9d42", "#c786ff", "#fff3d5"];

const DECORATIONS = [
  "aurora-nebula aurora-nebula--left",
  "aurora-nebula aurora-nebula--center",
  "aurora-nebula aurora-nebula--right",
  "aurora-cloud-texture aurora-cloud-texture--left",
  "aurora-cloud-texture aurora-cloud-texture--right",
  "aurora-solar-flare",
  "aurora-horizon-city",
  "aurora-grid-floor",
  "aurora-floor-pulse aurora-floor-pulse--one",
  "aurora-floor-pulse aurora-floor-pulse--two",
  "aurora-floor-pulse aurora-floor-pulse--three",
  "aurora-ring aurora-ring--one",
  "aurora-ring aurora-ring--two",
  "aurora-ring aurora-ring--three",
  "aurora-ribbon aurora-ribbon--one",
  "aurora-ribbon aurora-ribbon--two",
  "aurora-ribbon aurora-ribbon--three",
  "aurora-arc-pulse aurora-arc-pulse--one",
  "aurora-arc-pulse aurora-arc-pulse--two",
  "aurora-arc-pulse aurora-arc-pulse--three",
  "aurora-comet aurora-comet--one",
  "aurora-comet aurora-comet--two",
  "aurora-comet aurora-comet--three"
];

export default function AuroraWorld({ seed }) {
  return (
    <div className="karaoke-aurora-world" aria-hidden="true">
      {DECORATIONS.map((className) => (
        <i key={className} className={className} />
      ))}
      <div className="aurora-stars">
        {Array.from({ length: 96 }, (_, index) => (
          <i
            key={index}
            style={{
              "--aurora-x": `${(index * 47 + seed) % 100}%`,
              "--aurora-y": `${(index * 29 + seed * 3) % 92}%`,
              "--aurora-delay": `${(index * -137) % 5800}ms`,
              "--aurora-depth": `${1 + (index % 4)}`
            }}
          />
        ))}
      </div>
      <div className="aurora-particles">
        {Array.from({ length: 112 }, (_, index) => (
          <i
            key={index}
            style={{
              "--particle-angle": `${(index * 137.5 + seed) % 360}deg`,
              "--particle-distance": `${32 + ((index * 29) % 74)}vmax`,
              "--particle-delay": `${(index * -211) % 6000}ms`,
              "--particle-size": `${1 + (index % 6)}px`,
              "--particle-color": PARTICLE_COLORS[index % PARTICLE_COLORS.length]
            }}
          />
        ))}
      </div>
    </div>
  );
}
