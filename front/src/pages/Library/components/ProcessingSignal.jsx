export default function ProcessingSignal({ progress = 0, compact = false }) {
  const normalized = Math.max(0, Math.min(100, Number(progress) || 0));
  const bars = Array.from({ length: compact ? 24 : 42 }, (_, index) => index);

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
      <div className="processing-signal__bars" aria-hidden="true">
        {bars.map((index) => (
          <i key={index} style={{ "--bar-index": index, "--bar-height": `${24 + ((index * 17) % 68)}%` }} />
        ))}
      </div>
      <span className="processing-signal__cursor" aria-hidden="true" />
      <span className="processing-signal__value">{Math.round(normalized)}%</span>
    </div>
  );
}
