import { api } from "../../../../api/client";
import Table from "../../../../components/Table";
import { POLLING_INTERVALS } from "../../../../runtime-config";
import { usePolling } from "../../../../hooks/usePolling";
import { useI18n } from "../../../../i18n";
import { Chip, Stack, Typography } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";
import { HISTORY_ACTIONS, HISTORY_COLUMNS, RECORDING_STATUSES } from "./config";

export default function History() {
  const { language, t } = useI18n();
  const { data: history, error } = usePolling(
    api.getHistory,
    POLLING_INTERVALS.history,
    []
  );

  return (
    <Stack gap={1} className="settings-table-screen">
      <Typography variant="h3">{t("settings.history.title")}</Typography>

      {error && (
        <Typography variant="body2" sx={{ color: "var(--ui-danger)" }}>
          {getErrorMessage(error)}
        </Typography>
      )}

      <div className="settings-table-wrap">
        <Table
          columns={HISTORY_COLUMNS.map((key) => [
            key,
            t(`settings.history.${key}`)
          ])}
          data={history ?? []}
          getRowKey={(item, index) =>
            item.id ??
            `${item.song_title}-${item.kind}-${item.timestamp ?? index}`
          }
          renderRow={(item) => getHistoryRow(item, t, language)}
          emptyText={t("settings.history.empty")}
        />
      </div>
    </Stack>
  );
}

const formatDuration = (value, t) => {
  if (value == null) return "—";
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0
    ? t("settings.history.seconds", { count: Math.round(seconds) })
    : "—";
};

const formatTimestamp = (value, language) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString({ uk: "uk-UA", ru: "ru-RU", en: "en-US" }[language]);
};

const getHistoryRow = (
  { song_title, kind, status, duration_seconds, timestamp },
  t,
  language
) => [
  [song_title ?? "—", "history-song"],
  [
    HISTORY_ACTIONS.has(kind) ? t(`settings.history.${kind}`) : (kind ?? "—"),
    "text-secondary"
  ],
  [renderStatus(kind, status, t)],
  [formatDuration(duration_seconds, t), "mono text-muted"],
  [formatTimestamp(timestamp, language), "text-muted"]
];

const PROCESSING_STATUSES = {
  pending: "default",
  queued: "default",
  processing: "primary",
  cancelling: "primary",
  cancelled: "danger",
  done: "success",
  error: "danger"
};

const renderStatus = (kind, status, t) => {
  if (kind === "processing") {
    const tone = PROCESSING_STATUSES[status] ?? "default";
    const label = status
      ? t(`status.${status}`, {}, status)
      : t("status.unknown");

    return (
      <Chip size="sm" tone={tone}>
        {label}
      </Chip>
    );
  }

  return (
    <Typography as="span" variant="body2" tone="muted">
      {RECORDING_STATUSES.has(status)
        ? t(`settings.history.${status}`)
        : (status ?? "—")}
    </Typography>
  );
};
