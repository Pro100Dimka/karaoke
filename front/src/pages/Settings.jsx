import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Panel } from "../components/ui";
import { Dropdown } from "../components/Dropdown";

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAppSettings().then(setForm).catch((err) => alert(`Не удалось загрузить настройки: ${err.message}`));
  }, []);

  useEffect(() => {
    if (form?.theme) document.documentElement.dataset.theme = form.theme;
  }, [form?.theme]);

  if (!form) return <Panel title="Настройки программы"><p className="text-muted">Загрузка...</p></Panel>;

  const set = (field) => (value) => {
    if (field === "theme") {
      document.documentElement.dataset.theme = value;
    }
    setForm((formState) => ({ ...formState, [field]: value }));
  };

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
          <Dropdown value={form.language} onChange={set("language")} options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]} />
        </Row>
        <Row label="Тема">
          <Dropdown value={form.theme} onChange={set("theme")} options={[{ value: "dark", label: "Тёмная" }, { value: "light", label: "Светлая" }]} />
        </Row>
        <Row label="Папка с песнями">
          <input className="input" value={form.songs_folder || ""} readOnly />
        </Row>
        <Row label="Папка AI">
          <input className="input" value={form.ai_folder || ""} readOnly />
        </Row>
        <Row label="Папка записей">
          <input className="input" value={form.recordings_folder || ""} readOnly />
        </Row>
        <Row label="Папка кэша">
          <input className="input" value={form.cache_folder || ""} readOnly />
        </Row>
        <Row label="Модель Whisper">
          <Dropdown value={form.whisper_model} onChange={set("whisper_model")} options={["tiny", "base", "small", "medium", "large"].map((value) => ({ value, label: value }))} />
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
      <div style={{ marginTop: 28, paddingTop: 18, borderTop: "1px solid var(--card-border)" }}>
        <div className="text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>Обслуживание и информация</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn btn-ghost" to="/models">Модели AI</Link>
          <Link className="btn btn-ghost" to="/memory">Хранилище</Link>
          <Link className="btn btn-ghost" to="/history">История</Link>
          <Link className="btn btn-ghost" to="/diagnostics">Диагностика</Link>
          <Link className="btn btn-ghost" to="/about">О программе</Link>
        </div>
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
