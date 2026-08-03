import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { useAppDialog } from "../components/AppDialog";

const DIFFICULTIES = ["Лёгкий", "Средний", "Сложный", "Эксперт"];

export default function SongSettings() {
  const { alert: notify } = useAppDialog();
  const location = useLocation();
  const { data: songs } = usePolling(api.listSongs, 5000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId ? (songs || []).find((s) => s.id === songId) : (songs || [])[0];

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
        const lines = Array.isArray(result.lyrics_sync) ? result.lyrics_sync : [];
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
      const lyrics = lyricsData.map((line, index) => ({ ...line, text: textLines[index] || line.text }));
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

  return (
    <div className="song-settings-workspace">
      <Panel title={`Настройки песни — ${song.title}`}>
        <FieldRow label="Тональность">
          <input className="input" value={form.key_override || ""} placeholder="напр. C#m"
                 onChange={(e) => set("key_override")(e.target.value)} />
        </FieldRow>
        <FieldRow label={"\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u043f\u0435\u0441\u043d\u0438"}>
          <input className="input" value={form.title || ""}
                 onChange={(e) => set("title")(e.target.value)} />
        </FieldRow>
        <FieldRow label={"\u0413\u0440\u0443\u043f\u043f\u0430 / \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c"}>
          <input className="input" value={form.artist || ""} placeholder="Muse"
                 onChange={(e) => set("artist")(e.target.value)} />
        </FieldRow>
        <FieldRow label={"\u0416\u0430\u043d\u0440"}>
          <input className="input" value={form.genre || ""} placeholder="Alternative rock"
                 onChange={(e) => set("genre")(e.target.value)} />
        </FieldRow>
        <FieldRow label="Темп (BPM)">
          <input type="number" className="input" value={form.tempo_override || ""}
                 onChange={(e) => set("tempo_override")(Number(e.target.value) || null)} />
        </FieldRow>
        <FieldRow label="Диапазон нот (MIDI)">
          <div style={{ display: "flex", gap: 8 }}>
            <input type="number" className="input" style={{ width: 90 }} value={form.note_range_min ?? ""}
                   onChange={(e) => set("note_range_min")(Number(e.target.value))} placeholder="min" />
            <input type="number" className="input" style={{ width: 90 }} value={form.note_range_max ?? ""}
                   onChange={(e) => set("note_range_max")(Number(e.target.value))} placeholder="max" />
          </div>
        </FieldRow>
        <FieldRow label="Уровень сложности">
          <Dropdown value={form.difficulty_override || ""} onChange={set("difficulty_override")}
            options={[{ value: "", label: "Авто (по AI)" }, ...DIFFICULTIES.map((value) => ({ value, label: value }))]} />
        </FieldRow>
        <FieldRow label="Ссылка на клип">
          <input className="input" type="url" value={form.video_url || ""}
                 placeholder="https://example.com/video.mp4"
                 onChange={(e) => set("video_url")(e.target.value)} />
        </FieldRow>
        <p className="text-muted" style={{ margin: "-5px 0 14px", fontSize: 12 }}>
          Поддерживаются YouTube-ссылки и прямые ссылки на MP4/WebM. Клип будет идти без звука и синхронно с песней.
        </p>
        <FieldRow label="Показывать текст">
          <input type="checkbox" checked={form.show_lyrics} onChange={(e) => set("show_lyrics")(e.target.checked)} />
        </FieldRow>
        <FieldRow label="Показывать ноты">
          <input type="checkbox" checked={form.show_notes} onChange={(e) => set("show_notes")(e.target.checked)} />
        </FieldRow>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={save} disabled={saving}>
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </Panel>
      {song.status === "done" && (
        <Panel className="song-lyrics-panel" title="\u0420\u0435\u0434\u0430\u043a\u0442\u043e\u0440 \u0442\u0435\u043a\u0441\u0442\u0430">
          <p className="text-muted" style={{ marginTop: 0, fontSize: 12 }}>\u041a\u0430\u0436\u0434\u0430\u044f \u0441\u0442\u0440\u043e\u043a\u0430 ? \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u0430\u044f \u0441\u0442\u0440\u043e\u043a\u0430 \u043f\u0435\u0441\u043d\u0438. \u0422\u0430\u0439\u043c\u0438\u043d\u0433\u0438 \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u044e\u0442\u0441\u044f \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438.</p>
          <textarea className="input song-lyrics-editor" value={lyricsText}
            onChange={(event) => setLyricsText(event.target.value)} spellCheck={false} />
          {lyricsError && <p className="song-lyrics-error">{lyricsError}</p>}
        </Panel>
      )}
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <span className="text-secondary" style={{ fontSize: 13 }}>{label}</span>
      {children}
    </div>
  );
}
