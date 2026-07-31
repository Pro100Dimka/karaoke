import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Panel } from "../components/ui";

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAppSettings().then(setForm);
  }, []);

  if (!form) return <Panel title="Настройки программы"><p className="text-muted">Загрузка...</p></Panel>;

  const set = (field) => (value) => setForm((f) => ({ ...f, [field]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateAppSettings(form);
    } catch (err) {
      alert(`Не удалось сохранить: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Настройки программы" actions={
      <button className="btn btn-primary" onClick={save} disabled={saving}>
        {saving ? "Сохранение..." : "Сохранить"}
      </button>
    }>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 32px", maxWidth: 800 }}>
        <Row label="Язык">
          <select className="input" value={form.language} onChange={(e) => set("language")(e.target.value)}>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </Row>
        <Row label="Тема">
          <select className="input" value={form.theme} onChange={(e) => set("theme")(e.target.value)}>
            <option value="dark">Тёмная</option>
            <option value="light">Светлая</option>
          </select>
        </Row>
        <Row label="Папка с песнями">
          <input className="input" value={form.songs_folder || ""} placeholder="по умолчанию"
                 onChange={(e) => set("songs_folder")(e.target.value)} />
        </Row>
        <Row label="Папка AI">
          <input className="input" value={form.ai_folder || ""} placeholder="по умолчанию"
                 onChange={(e) => set("ai_folder")(e.target.value)} />
        </Row>
        <Row label="Папка записей">
          <input className="input" value={form.recordings_folder || ""} placeholder="по умолчанию"
                 onChange={(e) => set("recordings_folder")(e.target.value)} />
        </Row>
        <Row label="Папка кэша">
          <input className="input" value={form.cache_folder || ""} placeholder="по умолчанию"
                 onChange={(e) => set("cache_folder")(e.target.value)} />
        </Row>
        <Row label="Модель Whisper">
          <select className="input" value={form.whisper_model} onChange={(e) => set("whisper_model")(e.target.value)}>
            {["tiny", "base", "small", "medium", "large"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Row>
        <Row label="Количество потоков">
          <input type="number" className="input" min={1} max={64} value={form.thread_count}
                 onChange={(e) => set("thread_count")(Number(e.target.value))} />
        </Row>
        <Row label="Использовать GPU">
          <input type="checkbox" checked={form.use_gpu} onChange={(e) => set("use_gpu")(e.target.checked)} />
        </Row>
        <Row label="Использовать CPU">
          <input type="checkbox" checked={form.use_cpu} onChange={(e) => set("use_cpu")(e.target.checked)} />
        </Row>
        <Row label="Автосохранение">
          <input type="checkbox" checked={form.autosave} onChange={(e) => set("autosave")(e.target.checked)} />
        </Row>
        <Row label="Автообновление">
          <input type="checkbox" checked={form.autoupdate} onChange={(e) => set("autoupdate")(e.target.checked)} />
        </Row>
      </div>
    </Panel>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
      <span className="text-secondary" style={{ fontSize: 13 }}>{label}</span>
      {children}
    </div>
  );
}
