import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { Panel } from "../../components/ui";
import { Dropdown } from "../../components/Dropdown";
import { Trash2, Sparkles, FolderX } from "lucide-react";
import { useState } from "react";
import { useAppDialog } from "../../components/AppDialog";

const LABELS = {
  full_songs: "Песни (оригиналы)",
  song_results: "Результаты AI",
  database: "База данных",
};

export default function MemoryManager() {
  const { alert: notify } = useAppDialog();
  const { data: size, error } = usePolling(api.getCacheSize, 5000, []);
  const { data: free } = usePolling(api.getFreeSpace, 10000, []);
  const { data: songs } = usePolling(api.listSongs, 8000, []);
  const [optimizeTarget, setOptimizeTarget] = useState("");

  const clear = async () => {
    try {
      const res = await api.clearCache();
      await notify(
        `Освобождено: ${(res.freed_bytes / 1024 / 1024).toFixed(1)} МБ`,
      );
    } catch (err) {
      await notify(err.message);
    }
  };

  const deleteTemp = async () => {
    try {
      const res = await api.deleteTemp();
      await notify(
        `Удалено временных файлов: ${(res.freed_bytes / 1024 / 1024).toFixed(1)} МБ`,
      );
    } catch (err) {
      await notify(err.message);
    }
  };

  return (
    <Panel title="Управление памятью">
      {error && <p style={{ color: "var(--danger)" }}>{error.message}</p>}
      {size && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 14,
              marginBottom: 20,
            }}
          >
            {Object.entries(size.breakdown).map(([key, bytes]) => (
              <div
                key={key}
                style={{
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {LABELS[key] || key}
                </div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>
                  {(bytes / 1024 / 1024).toFixed(1)} МБ
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 14, marginBottom: 4 }}>
            Всего занято: <b>{size.total_human}</b>
          </div>
          {free && (
            <div
              className="text-muted"
              style={{ fontSize: 13, marginBottom: 20 }}
            >
              Свободно на диске: {free.free_human} из {free.total_human}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={clear}>
              <Sparkles size={14} /> Очистить кэш
            </button>
            <button className="btn btn-ghost" onClick={deleteTemp}>
              <FolderX size={14} /> Удалить временные файлы
            </button>
          </div>

          <div
            style={{
              marginTop: 20,
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <Dropdown
              value={optimizeTarget}
              onChange={setOptimizeTarget}
              options={[
                { value: "", label: "Оптимизировать файлы песни..." },
                ...(songs || [])
                  .filter((song) => song.status === "done" && !song.optimized)
                  .map((song) => ({ value: song.id, label: song.title })),
              ]}
            />
            <button
              className="btn btn-ghost"
              disabled={!optimizeTarget}
              onClick={async () => {
                try {
                  const res = await api.optimizeSong(optimizeTarget);
                  await notify(`Освобождено: ${res.freed_human}`);
                  setOptimizeTarget("");
                } catch (err) {
                  await notify(err.message);
                }
              }}
            >
              <Trash2 size={14} /> Оптимизировать
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}
