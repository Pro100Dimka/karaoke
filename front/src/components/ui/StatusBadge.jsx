import { useI18n } from "../../i18n";

const STATUS_CLASS = {
  pending: "badge-pending",
  queued: "badge-pending",
  processing: "badge-processing",
  cancelling: "badge-processing",
  cancelled: "badge-cancelled",
  done: "badge-done",
  error: "badge-error"
};

export default function StatusBadge({ status }) {
  const { t } = useI18n();
  const className = STATUS_CLASS[status] ?? "badge-pending";
  const label = status
    ? t(`status.${status}`, {}, status)
    : t("status.unknown");

  return (
    <span className={`badge ${className}`}>
      <span className="badge-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
