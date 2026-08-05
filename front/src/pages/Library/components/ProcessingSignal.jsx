export default function ProcessingSignal({ progress = 0, compact = false }) {
  const normalized = Math.max(0, Math.min(100, Number(progress) || 0));
  const points = [
    22, 30, 18, 42, 28, 54, 24, 64, 36, 48, 18, 32, 46, 58, 26, 40,
    16, 52, 68, 36, 24, 44, 30, 56, 20, 34, 62, 48, 28, 38, 18, 50,
    70, 42, 26, 54, 32, 46, 20, 36, 58, 30, 16, 44, 66, 40, 24, 52
  ];
  const width = 960;
  const height = compact ? 54 : 116;
  const center = height / 2;
  const step = width / (points.length - 1);
  const upper = points.map((value, index) => `${index * step},${center - value * (compact ? 0.28 : 0.55)}`).join(" ");
  const lower = [...points].reverse().map((value, reverseIndex) => {
    const index = points.length - 1 - reverseIndex;
    return `${index * step},${center + value * (compact ? 0.28 : 0.55)}`;
  }).join(" ");
  const polygon = `${upper} ${lower}`;
  const clipId = `processing-${compact ? "compact" : "full"}-${Math.round(normalized)}`;

  return (
    <div
      className={`processing-signal${compact ? " processing-signal--compact" : ""}`}
      style={{ "--processing-progress": `${normalized}%` }}
      aria-label={`Обработка: ${Math.round(normalized)}%`}
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={Math.round(normalized)}
    >
      <svg className="processing-signal__wave" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${clipId}-gradient`} x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-highlight)" />
            <stop offset="0.55" stopColor="var(--color-primary)" />
            <stop offset="1" stopColor="var(--color-accent)" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={(width * normalized) / 100} height={height} />
          </clipPath>
        </defs>
        <line className="processing-signal__baseline" x1="0" y1={center} x2={width} y2={center} />
        <polygon className="processing-signal__wave-muted" points={polygon} />
        <polygon className="processing-signal__wave-active" points={polygon} fill={`url(#${clipId}-gradient)`} clipPath={`url(#${clipId})`} />
      </svg>
      <span className="processing-signal__cursor" aria-hidden="true" />
      <span className="processing-signal__value">{Math.round(normalized)}%</span>
    </div>
  );
}
