import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { Panel, StatusBadge } from "../../components/ui";

export default function History() {
  const { data: history, error } = usePolling(api.getHistory, 5000, []);

  return (
    <Panel title="История">
      {error && <p style={{ color: "var(--danger)" }}>{error.message}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Песня</th>
            <th>Действие</th>
            <th>Статус</th>
            <th>Длительность</th>
            <th>Когда</th>
          </tr>
        </thead>
        <tbody>
          {(history || []).map((h, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{h.song_title}</td>
              <td className="text-secondary">
                {h.kind === "processing" ? "Обработка AI" : "Запись голоса"}
              </td>
              <td>
                {h.kind === "processing" ? (
                  <StatusBadge status={h.status} />
                ) : (
                  <span className="text-muted">
                    {h.status === "analyzed" ? "проанализирована" : "записана"}
                  </span>
                )}
              </td>
              <td className="mono text-muted">
                {h.duration_seconds
                  ? `${h.duration_seconds.toFixed(0)} с`
                  : "—"}
              </td>
              <td className="text-muted">
                {h.timestamp
                  ? new Date(h.timestamp).toLocaleString("ru-RU")
                  : "—"}
              </td>
            </tr>
          ))}
          {(history || []).length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="text-muted"
                style={{ textAlign: "center", padding: 20 }}
              >
                История пуста
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}
