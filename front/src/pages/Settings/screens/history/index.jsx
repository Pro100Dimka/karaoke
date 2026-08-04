import { api } from "../../../../api/client";
import Table from "../../../../components/table";
import { Panel, StatusBadge } from "../../../../components/ui";
import { usePolling } from "../../../../hooks/usePolling";
import { HISTORY_ACTIONS, HISTORY_COLUMNS, RECORDING_STATUSES } from "./config";

export default function History() {
  const { data: history, error } = usePolling(api.getHistory, 5000, []);
  return (
    <Panel title="История">
      {error && <p className="text-danger">{error.message}</p>}
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
  [
    duration_seconds == null ? "—" : `${Number(duration_seconds).toFixed(0)} с`,
    "mono text-muted"
  ],
  [timestamp ? new Date(timestamp).toLocaleString("ru-RU") : "—", "text-muted"]
];

const renderStatus = (kind, status) => {
  if (kind === "processing") return <StatusBadge status={status} />;
  return (
    <span className="text-muted">
      {RECORDING_STATUSES[status] ?? status ?? "—"}
    </span>
  );
};
