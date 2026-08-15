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
  ...["floor-pulse", "ring", "ribbon", "arc-pulse", "comet"].flatMap((type) =>
    ["one", "two", "three"].map(
      (variant) => `aurora-${type} aurora-${type}--${variant}`
    )
  )
];

const STARS = Array.from({ length: 96 }, (_, index) => index);
const PARTICLES = Array.from({ length: 112 }, (_, index) => index);

const starStyle = (index, seed) => ({
  "--aurora-x": `${(index * 47 + seed) % 100}%`,
  "--aurora-y": `${(index * 29 + seed * 3) % 92}%`,
  "--aurora-delay": `${(index * -137) % 5800}ms`,
  "--aurora-depth": 1 + (index % 4)
});

const particleStyle = (index, seed) => ({
  "--particle-angle": `${(index * 137.5 + seed) % 360}deg`,
  "--particle-distance": `${32 + ((index * 29) % 74)}vmax`,
  "--particle-delay": `${(index * -211) % 6000}ms`,
  "--particle-size": `${1 + (index % 6)}px`,
  "--particle-color": PARTICLE_COLORS[index % PARTICLE_COLORS.length]
});

function Elements({ items, getStyle }) {
  return items.map((index) => <i key={index} style={getStyle(index)} />);
}

export default function AuroraWorld({ seed }) {
  return (
    <div className="karaoke-aurora-world" aria-hidden="true">
      {DECORATIONS.map((className) => ( <i key={className} className={className} /> ))}
      <div className="aurora-stars">
        <Elements items={STARS} getStyle={(index) => starStyle(index, seed)} />
      </div>
      <div className="aurora-particles">
        <Elements
          items={PARTICLES}
          getStyle={(index) => particleStyle(index, seed)}
        />
      </div>
    </div>
  );
}
