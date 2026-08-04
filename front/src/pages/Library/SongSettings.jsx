import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { Panel } from "../../components/ui";
import { Dropdown } from "../../components/Dropdown";
import { useAppDialog } from "../../components/AppDialog";

const DIFFICULTIES = ["Лёгкий", "Средний", "Сложный", "Эксперт"];

export default function SongSettings() {
  const { alert: notify } = useAppDialog();
  const location = useLocation();
  const { data: songs } = usePolling(api.listSongs, 5000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId
    ? (songs || []).find((s) => s.id === songId)
    : (songs || [])[0];

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  const [lyricsData, setLyricsData] = useState([]);
  const [lyricsError, setLyricsError] = useState(null);

  useEffect(() => {
    if (song) setForm({ ...song });
  }, [song?.id]);

  useEffect(() => {
    if (!song || song.status !== "done") {
      setLyricsText("");
      setLyricsData([]);
      return;
    }
    let active = true;
    api
      .getResult(song.id)
      .then((result) => {
        if (!active) return;
        const lines = Array.isArray(result.lyrics_sync)
          ? result.lyrics_sync
          : [];
        setLyricsData(lines);
        setLyricsText(lines.map((line) => line.text || "").join("\n"));
      })
      .catch(() => {
        if (!active) return;
        setLyricsData([]);
        setLyricsText("");
      });
    return () => {
      active = false;
    };
  }, [song?.id, song?.status]);

  if (!song || !form) {
    return (
      <Panel title="Настройки песни">
        <p className="text-muted">Нет песен — добавьте песню в Библиотеке.</p>
      </Panel>
    );
  }

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));
  const setEvent = (field) => (e) => set(field)(e.target.value);

  const saveLyrics = async () => {
    try {
      const textLines = lyricsText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (textLines.length > lyricsData.length) {
        setLyricsError(
          "Нельзя добавить новые строки без таймингов. Сначала добавьте их при обработке песни.",
        );
        return false;
      }
      const lyrics = lyricsData.map((line, index) => ({
        ...line,
        text: textLines[index] || line.text,
      }));
      await api.updateLyrics(song.id, lyrics);
      setLyricsData(lyrics);
      setLyricsText(lyrics.map((line) => line.text || "").join("\n"));
      setLyricsError(null);
      return true;
    } catch (error) {
      setLyricsError(error.message || "Не удалось сохранить текст");
      return false;
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (song.status === "done" && !(await saveLyrics())) return;
      await api.updateSong(song.id, {
        title: form.title?.trim() || song.title,
        artist: form.artist?.trim() || null,
        genre: form.genre?.trim() || null,
        key_override: form.key_override,
        tempo_override: form.tempo_override,
        note_range_min: form.note_range_min,
        note_range_max: form.note_range_max,
        difficulty_override: form.difficulty_override,
        video_url: form.video_url?.trim() || null,
        show_lyrics: form.show_lyrics,
        show_notes: form.show_notes,
      });
    } catch (err) {
      await notify(`Не удалось сохранить: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    {
      label: "Тональность",
      render: () => (
        <input
          className="input"
          value={form.key_override || ""}
          placeholder="напр. C#m"
          onChange={setEvent("key_override")}
        />
      ),
    },
    {
      label: "Название песни",
      render: () => (
        <input
          className="input"
          value={form.title || ""}
          onChange={setEvent("title")}
        />
      ),
    },
    {
      label: "Группа / исполнитель",
      render: () => (
        <input
          className="input"
          value={form.artist || ""}
          placeholder="Muse"
          onChange={setEvent("artist")}
        />
      ),
    },
    {
      label: "Жанр",
      render: () => (
        <input
          className="input"
          value={form.genre || ""}
          placeholder="Alternative rock"
          onChange={setEvent("genre")}
        />
      ),
    },
    {
      label: "Темп (BPM)",
      render: () => (
        <input
          type="number"
          className="input"
          value={form.tempo_override || ""}
          onChange={(e) =>
            set("tempo_override")(Number(e.target.value) || null)
          }
        />
      ),
    },
    {
      label: "Диапазон нот (MIDI)",
      render: () => (
        <div className="flex gap-3">
          <input
            type="number"
            className="input note-range-input"
            value={form.note_range_min ?? ""}
            onChange={(e) => set("note_range_min")(Number(e.target.value))}
            placeholder="min"
          />
          <input
            type="number"
            className="input note-range-input"
            value={form.note_range_max ?? ""}
            onChange={(e) => set("note_range_max")(Number(e.target.value))}
            placeholder="max"
          />
        </div>
      ),
    },
    {
      label: "Уровень сложности",
      render: () => (
        <Dropdown
          value={form.difficulty_override || ""}
          onChange={set("difficulty_override")}
          options={[
            { value: "", label: "Авто (по AI)" },
            ...DIFFICULTIES.map((value) => ({ value, label: value })),
          ]}
        />
      ),
    },
    {
      label: "Ссылка на клип",
      render: () => (
        <input
          className="input"
          type="url"
          value={form.video_url || ""}
          placeholder="https://example.com/video.mp4"
          onChange={setEvent("video_url")}
        />
      ),
    },
    {
      hint: "Поддерживаются YouTube-ссылки и прямые ссылки на MP4/WebM. Клип будет идти без звука и синхронно с песней.",
    },
    {
      label: "Показывать текст",
      render: () => (
        <input
          type="checkbox"
          checked={form.show_lyrics}
          onChange={(e) => set("show_lyrics")(e.target.checked)}
        />
      ),
    },
    {
      label: "Показывать ноты",
      render: () => (
        <input
          type="checkbox"
          checked={form.show_notes}
          onChange={(e) => set("show_notes")(e.target.checked)}
        />
      ),
    },
  ];

  return (
    <div className="song-settings-workspace">
      <Panel title={`Настройки песни — ${song.title}`}>
        {fields.map((field, index) =>
          field.hint ? (
            <p key={index} className="text-muted text-xs song-settings-hint">
              {field.hint}
            </p>
          ) : (
            <FieldRow key={field.label} label={field.label}>
              {field.render()}
            </FieldRow>
          ),
        )}
        <button
          className="btn btn-primary mt-4"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </Panel>
      {song.status === "done" && (
        <Panel className="song-lyrics-panel" title="Редактор текста">
          <p className="text-muted text-xs song-settings-hint">
            Каждая строка — отдельная строка песни. Тайминги сохраняются
            автоматически.
          </p>
          <textarea
            className="input song-lyrics-editor"
            value={lyricsText}
            onChange={(event) => setLyricsText(event.target.value)}
            spellCheck={false}
          />
          {lyricsError && <p className="song-lyrics-error">{lyricsError}</p>}
        </Panel>
      )}
    </div>
  );
}
function FieldRow({ label, children }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <span className="text-secondary" style={{ fontSize: 13 }}>
        {label}
      </span>
      {children}
    </div>
  );
}
