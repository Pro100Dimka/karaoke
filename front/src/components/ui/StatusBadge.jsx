const STATUS = {
  pending: { label: "Ожидание", className: "badge-pending" },
  queued: { label: "В очереди", className: "badge-pending" },
  processing: { label: "Обрабатывается", className: "badge-processing" },
  cancelling: { label: "Отмена...", className: "badge-processing" },
  cancelled: { label: "Отменено", className: "badge-cancelled" },
  done: { label: "Готово", className: "badge-done" },
  error: { label: "Ошибка", className: "badge-error" }
};

export default function StatusBadge({ status }) {
  const current = STATUS[status] ?? {
    label: status || "Неизвестно",
    className: "badge-pending"
  };

  return (
    <span className={`badge ${current.className}`}>
      <span className="badge-dot" aria-hidden="true" />
      {current.label}
    </span>
  );
}
