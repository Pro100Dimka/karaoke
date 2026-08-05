function clampPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, percent));
}

export default function ProgressBar({ percent = 0, label = "Прогресс" }) {
  const normalizedPercent = clampPercent(percent);

  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalizedPercent}
    >
      <div
        className="progress-fill"
        style={{ width: `${normalizedPercent}%` }}
      />
    </div>
  );
}
