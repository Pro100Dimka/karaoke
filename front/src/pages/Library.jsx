import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Play, Trash2, FolderOpen, Search, Info } from "lucide-react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel, StatusBadge, ProgressBar } from "../components/ui";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU");
}

export default function Library() {
  const [query, setQuery] = useState("");
  const [infoSong, setInfoSong] = useState(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const { data: songs, error } = usePolling(api.listSongs, 3000, []);

  const handleAddClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChosen = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await api.addSong(file, file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      alert(`Не удалось добавить песню: ${err.message}`);
    }
  }, []);

  const handleDelete = useCallback(async (song) => {
    if (!confirm(`Удалить "${song.title}"? Это удалит все файлы песни.`)) return;
    try {
      await api.deleteSong(song.id);
    } catch (err) {
      alert(`Не удалось удалить: ${err.message}`);
    }
  }, []);

  const handleProcess = useCallback(
    async (song) => {
      try {
        await api.processSong(song.id);
        navigate("/processing", { state: { songId: song.id } });
      } catch (err) {
        alert(`Не удалось запустить обработку: ${err.message}`);
      }
    },
    [navigate]
  );

  const handleOpenFolder = useCallback((song) => {
    if (!song.output_dir && !window.electronAPI) {
      alert("Папка ещё не создана — песня не обработана");
      return;
    }
    window.electronAPI?.openPath(song.output_dir || "");
  }, []);

  const filtered = (songs || []).filter((s) =>
    s.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      <Panel
        title="Библиотека песен"
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={handleAddClick}>
              <Plus size={15} /> Добавить песню
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
              style={{ display: "none" }}
              onChange={handleFileChosen}
            />
          </div>
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
            <Search
              size={14}
              style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }}
            />
            <input
              className="input"
              style={{ width: "100%", paddingLeft: 30 }}
              placeholder="Поиск..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {filtered.length} песен
          </span>
        </div>

        {error && <p style={{ color: "var(--danger)" }}>Не удалось загрузить список: {error.message}</p>}

        <table className="data-table">
          <thead>
            <tr>
              <th>Название</th>
              <th>Статус</th>
              <th style={{ width: 160 }}>Прогресс</th>
              <th>Добавлена</th>
              <th style={{ width: 200 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((song) => (
              <tr key={song.id}>
                <td style={{ fontWeight: 600 }}>{song.title}</td>
                <td>
                  <StatusBadge status={song.status} />
                </td>
                <td>
                  {song.status === "processing" || song.status === "cancelling" ? (
                    <ProgressBar percent={song.progress_percent} />
                  ) : (
                    <span className="text-muted mono">{song.progress_percent}%</span>
                  )}
                </td>
                <td className="text-secondary">{formatDate(song.created_at)}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    {song.status === "done" ? (
                      <button
                        className="btn btn-ghost"
                        title="Открыть в караоке"
                        onClick={() => navigate("/karaoke", { state: { songId: song.id } })}
                      >
                        <Play size={14} />
                      </button>
                    ) : (
                      <button
                        className="btn btn-ghost"
                        title="Обработать"
                        disabled={song.status === "processing" || song.status === "cancelling"}
                        onClick={() => handleProcess(song)}
                      >
                        <Play size={14} />
                      </button>
                    )}
                    <button className="btn btn-ghost" title="Информация" onClick={() => setInfoSong(song)}>
                      <Info size={14} />
                    </button>
                    <button
                      className="btn btn-ghost"
                      title="Открыть папку песни"
                      onClick={() => handleOpenFolder(song)}
                    >
                      <FolderOpen size={14} />
                    </button>
                    <button className="btn btn-danger" title="Удалить" onClick={() => handleDelete(song)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="text-muted" style={{ textAlign: "center", padding: 24 }}>
                  Пока нет ни одной песни — добавьте первую
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      {infoSong && (
        <Panel title={`Информация — ${infoSong.title}`} style={{ marginTop: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 13 }}>
            <div><span className="text-muted">Файл: </span>{infoSong.original_filename}</div>
            <div><span className="text-muted">Тональность: </span>{infoSong.key_override || "—"}</div>
            <div><span className="text-muted">Темп: </span>{infoSong.tempo_override || "—"}</div>
            <div><span className="text-muted">Сложность: </span>{infoSong.difficulty_override || "—"}</div>
            <div><span className="text-muted">Оптимизирована: </span>{infoSong.optimized ? "да" : "нет"}</div>
            <div><span className="text-muted">Ошибка: </span>{infoSong.error_message || "—"}</div>
          </div>
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setInfoSong(null)}>
            Закрыть
          </button>
        </Panel>
      )}
    </div>
  );
}
