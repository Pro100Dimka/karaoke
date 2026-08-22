import { useI18n } from "../../i18n";
import { Chip } from "../../theme/ui";

const tones = {
  cancelled: "default",
  cancelling: "warning",
  done: "success",
  error: "danger",
  processing: "primary"
};

export default function StatusBadge({ status }) {
  const { t } = useI18n();
  const value = status || "unknown";
  return (
    <Chip data-status={value} tone={tones[value] || "warning"} size="sm">
      {t(value === "unknown" ? "status.unknown" : `status.${value}`, {}, value)}
    </Chip>
  );
}
