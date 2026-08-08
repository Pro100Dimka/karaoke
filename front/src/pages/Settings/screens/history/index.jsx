import { api } from "../../../../api/client";
import Table from "../../../../components/table";
import { Panel, StatusBadge } from "../../../../components/ui";
import { usePolling } from "../../../../hooks/usePolling";
import { getErrorMessage } from "../../../../utils/errors";
import { HISTORY_ACTIONS, HISTORY_COLUMNS, RECORDING_STATUSES } from "./config";

export default function History() {
  const { data: history, error } = usePolling(api.getHistory, 5000, []);
  return (
    <Panel title="История">
      {error && <p className="text-danger">{getErrorMessage(error)}</p>}
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
    </Panel>
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

const renderStatus = (kind, status) => {
  if (kind === "processing") return <StatusBadge status={status} />;
  return (
    <span className="text-muted">
      {RECORDING_STATUSES[status] ?? status ?? "—"}
    </span>
  );
};
