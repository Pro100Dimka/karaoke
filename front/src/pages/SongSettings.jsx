import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel } from "../components/ui";

const DIFFICULTIES = ["Лёгкий", "Средний", "Сложный", "Эксперт"];

export default function SongSettings() {
  const location = useLocation();
  const { data: songs } = usePolling(api.listSongs, 5000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId ? (songs || []).find((s) => s.id === songId) : (songs || [])[0];

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (song) setForm({ ...song });
  }, [song?.id]);

  if (!song || !form) {
    return (
      <Panel title="Настройки песни">
        <p className="text-muted">Нет песен — добавьте песню в Библиотеке.</p>
      </Panel>
    );
  }

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSong(song.id, {
        key_override: form.key_override,
        tempo_override: form.tempo_override,
        note_range_min: form.note_range_min,
        note_range_max: form.note_range_max,
        difficulty_override: form.difficulty_override,
        show_lyrics: form.show_lyrics,
        show_notes: form.show_notes,
      });
    } catch (err) {
      alert(`Не удалось сохранить: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <Panel title={`Настройки песни — ${song.title}`}>
        <FieldRow label="Тональность">
          <input className="input" value={form.key_override || ""} placeholder="напр. C#m"
                 onChange={(e) => set("key_override")(e.target.value)} />
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
          <select className="input" value={form.difficulty_override || ""}
                  onChange={(e) => set("difficulty_override")(e.target.value)}>
            <option value="">Авто (по AI)</option>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </FieldRow>
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
