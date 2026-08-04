import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { Panel } from "../../components/ui";
import { useAppDialog } from "../../contexts/AppDialog";
import { Download, Trash2, CheckCircle2 } from "lucide-react";

export default function ModelManager() {
  const { data: models, error } = usePolling(api.listWhisperModels, 4000, []);
  const { alert: notify, confirm: confirmDialog } = useAppDialog();

  const download = async (name) => {
    try {
      await api.downloadModel(name);
    } catch (err) {
      await notify(err.message);
    }
  };

  const remove = async (name) => {
    if (!(await confirmDialog(`Удалить модель ${name}?`))) return;
    try {
      await api.deleteModel(name);
    } catch (err) {
      await notify(err.message);
    }
  };

  const select = async (name) => {
    try {
      await api.selectModel(name);
    } catch (err) {
      await notify(err.message);
    }
  };

  return (
    <Panel title="Модели AI — Whisper">
      {error && <p style={{ color: "var(--danger)" }}>{error.message}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Модель</th>
            <th>Размер</th>
            <th>Статус</th>
            <th style={{ width: 240 }}></th>
          </tr>
        </thead>
        <tbody>
          {(models || []).map((m) => (
            <tr key={m.name}>
              <td style={{ fontWeight: 600, textTransform: "capitalize" }}>
                {m.name}
              </td>
              <td className="text-muted mono">
                {m.disk_size_bytes
                  ? `${(m.disk_size_bytes / 1024 / 1024).toFixed(0)} MB`
                  : `~${m.approx_size_mb} MB`}
              </td>
              <td>
                {m.selected && (
                  <span className="badge badge-done">
                    <span className="badge-dot" />
                    Выбрана
                  </span>
                )}
                {!m.selected && m.downloaded && (
                  <span className="badge badge-pending">
                    <span className="badge-dot" />
                    Скачана
                  </span>
                )}
                {!m.downloaded && (
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Не скачана
                  </span>
                )}
              </td>
              <td>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    justifyContent: "flex-end",
                  }}
                >
                  {!m.downloaded ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => download(m.name)}
                    >
                      <Download size={13} /> Скачать
                    </button>
                  ) : (
                    <>
                      {!m.selected && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => select(m.name)}
                        >
                          <CheckCircle2 size={13} /> Выбрать
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => remove(m.name)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
        Скачивание идёт в фоне — прогресс-бар недоступен (Whisper не отдаёт
        процент программно), статус «Скачана» появится, когда файл модели
        окажется на диске.
      </p>
    </Panel>
  );
}
