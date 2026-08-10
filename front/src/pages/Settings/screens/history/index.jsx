import { api } from "../../../../api/client";
import Table from "../../../../components/table";
import { usePolling } from "../../../../hooks/usePolling";
import { Card, Chip, Stack, Typography } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";
import { HISTORY_ACTIONS, HISTORY_COLUMNS, RECORDING_STATUSES } from "./config";

export default function History() {
  const { data: history, error } = usePolling(api.getHistory, 5000, []);

  return (
    <Card
      variant="animation"
      tilt={false}
      className="settings-screen-card"
      cardContent={{ style: { padding: "1.25rem" } }}
    >
      <Stack gap={1}>
        <Typography variant="h3">История</Typography>

        {error && (
          <Typography variant="body2" sx={{ color: "var(--ui-danger)" }}>
            {getErrorMessage(error)}
          </Typography>
        )}

        <Table
          columns={HISTORY_COLUMNS}
          data={history}
          getRowKey={(item, index) =>
            item.id ??
            `${item.song_title}-${item.kind}-${item.timestamp ?? index}`
          }
          renderRow={getHistoryRow}
          emptyText="История пуста"
        />
      </Stack>
    </Card>
  );
}

const formatDuration = (value) => {
  if (value == null) return "—";
  const seconds = Number(value);

  return Number.isFinite(seconds) && seconds >= 0
    ? `${Math.round(seconds)} с`
    : "—";
};

const formatTimestamp = (value) => {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
};

const getHistoryRow = ({
  song_title,
  kind,
  status,
  duration_seconds,
  timestamp
}) => [
  [song_title ?? "—", "history-song"],
  [HISTORY_ACTIONS[kind] ?? kind ?? "—", "text-secondary"],
  [renderStatus(kind, status)],
  [formatDuration(duration_seconds), "mono text-muted"],
  [formatTimestamp(timestamp), "text-muted"]
];

const PROCESSING_STATUSES = {
  pending: ["Ожидание", "default"],
  queued: ["В очереди", "default"],
  processing: ["Обрабатывается", "primary"],
  cancelling: ["Отмена...", "primary"],
  cancelled: ["Отменено", "danger"],
  done: ["Готово", "success"],
  error: ["Ошибка", "danger"]
};

const renderStatus = (kind, status) => {
  if (kind === "processing") {
    const [label, tone] = PROCESSING_STATUSES[status] ?? [
      status || "Неизвестно",
      "default"
    ];

    return (
      <Chip size="sm" tone={tone}>
        {label}
      </Chip>
    );
  }

  return (
    <Typography as="span" variant="body2" tone="muted">
      {RECORDING_STATUSES[status] ?? status ?? "—"}
    </Typography>
  );
};
