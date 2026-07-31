const STATUS_LABELS = {
  pending: "Ожидание",
  queued: "В очереди",
  processing: "Обрабатывается",
  cancelling: "Отмена...",
  cancelled: "Отменено",
  done: "Готово",
  error: "Ошибка",
};

const STATUS_CLASS = {
  pending: "badge-pending",
  queued: "badge-pending",
  processing: "badge-processing",
  cancelling: "badge-processing",
  cancelled: "badge-cancelled",
  done: "badge-done",
  error: "badge-error",
};

export function StatusBadge({ status }) {
  return (
    <span className={`badge ${STATUS_CLASS[status] || "badge-pending"}`}>
      <span className="badge-dot" />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function ProgressBar({ percent = 0 }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}

export function Panel({ title, actions, children, style }) {
  return (
    <div className="panel" style={style}>
      {title && (
        <div className="panel-header">
          <div className="panel-title">{title}</div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
