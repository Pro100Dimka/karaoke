import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Cpu, FolderCog, Palette, Save, Settings2, Wrench } from "lucide-react";
import { api } from "../api/client";
import { Panel } from "../components/ui";
import { Dropdown } from "../components/Dropdown";

const TABS = [
  { id: "appearance", label: "Интерфейс", icon: Palette },
  { id: "ai", label: "AI и обработка", icon: Cpu },
  { id: "storage", label: "Файлы", icon: FolderCog },
  { id: "service", label: "Обслуживание", icon: Wrench },
];

export default function Settings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("appearance");

  useEffect(() => {
    api.getAppSettings().then(setForm).catch((err) => alert(`Не удалось загрузить настройки: ${err.message}`));
  }, []);
  useEffect(() => {
    if (form?.theme) document.documentElement.dataset.theme = form.theme;
  }, [form?.theme]);

  if (!form) return <Panel title="Настройки программы"><p className="text-muted">Загружаем центр управления…</p></Panel>;

  const set = (field) => (value) => {
    if (field === "theme") document.documentElement.dataset.theme = value;
    setSaved(false);
    setForm((state) => ({ ...state, [field]: value }));
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.updateAppSettings(form);
      setSaved(true);
    } catch (err) {
      alert(`Не удалось сохранить: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-page">
      <section className="settings-hero">
        <div className="settings-hero-icon"><Settings2 size={28} /></div>
        <div>
          <span>КОНТРОЛЬНЫЙ ЦЕНТР</span>
          <h1>Настройки приложения</h1>
          <p>Персонализируйте студию, обработку и рабочее пространство.</p>
        </div>
        <button className="btn btn-primary settings-save" onClick={save} disabled={saving}>
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saving ? "Сохраняем…" : saved ? "Сохранено" : "Сохранить изменения"}
        </button>
      </section>

      <div className="settings-layout">
        <nav className="settings-tabs" aria-label="Разделы настроек">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
              <Icon size={17} /><span>{label}</span>
            </button>
          ))}
        </nav>

        <Panel title={TABS.find((item) => item.id === tab)?.label}>
          {tab === "appearance" && (
            <div className="settings-field-grid">
              <SettingField label="Язык интерфейса" hint="Язык элементов приложения">
                <Dropdown value={form.language} onChange={set("language")} options={[{ value: "ru", label: "Русский" }, { value: "en", label: "English" }]} />
              </SettingField>
              <SettingField label="Тема" hint="Применяется сразу, без перезапуска">
                <Dropdown value={form.theme} onChange={set("theme")} options={[{ value: "dark", label: "Тёмная" }, { value: "light", label: "Светлая" }]} />
              </SettingField>
              <ToggleField label="Автосохранение" hint="Сохранять изменения автоматически" checked={form.autosave} onChange={set("autosave")} />
              <ToggleField label="Автообновление" hint="Проверять новые версии приложения" checked={form.autoupdate} onChange={set("autoupdate")} />
            </div>
          )}
          {tab === "ai" && (
            <div className="settings-field-grid">
              <SettingField label="Модель Whisper" hint="Качество распознавания текста">
                <Dropdown value={form.whisper_model} onChange={set("whisper_model")} options={["tiny", "base", "small", "medium", "large"].map((value) => ({ value, label: value }))} />
              </SettingField>
              <SettingField label="Потоки CPU" hint="Больше потоков — быстрее обработка">
                <input type="number" className="input" min={1} max={64} value={form.thread_count} onChange={(event) => set("thread_count")(Number(event.target.value))} />
              </SettingField>
              <ToggleField label="Использовать GPU" hint="Ускоряет AI, если видеокарта поддерживается" checked={form.use_gpu} onChange={set("use_gpu")} />
              <ToggleField label="Использовать CPU" hint="Резервный режим обработки" checked={form.use_cpu} onChange={set("use_cpu")} />
            </div>
          )}
          {tab === "storage" && (
            <div className="settings-field-grid settings-path-grid">
              <SettingField label="Папка с песнями"><input className="input" value={form.songs_folder || ""} readOnly /></SettingField>
              <SettingField label="Папка AI"><input className="input" value={form.ai_folder || ""} readOnly /></SettingField>
              <SettingField label="Папка записей"><input className="input" value={form.recordings_folder || ""} readOnly /></SettingField>
              <SettingField label="Папка кэша"><input className="input" value={form.cache_folder || ""} readOnly /></SettingField>
            </div>
          )}
          {tab === "service" && (
            <div className="settings-service-grid">
              <ServiceLink to="/models" title="Модели AI" text="Загрузка и выбор моделей распознавания" />
              <ServiceLink to="/memory" title="Хранилище" text="Кэш, свободное место и очистка" />
              <ServiceLink to="/history" title="История" text="События и действия в приложении" />
              <ServiceLink to="/diagnostics" title="Диагностика" text="Проверка компонентов и окружения" />
              <ServiceLink to="/about" title="О программе" text="Версия и сведения о приложении" />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function SettingField({ label, hint, children }) {
  return <label className="settings-field"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>{children}</label>;
}
function ToggleField({ label, hint, checked, onChange }) {
  return <label className="settings-toggle"><span><strong>{label}</strong><small>{hint}</small></span><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} /></label>;
}
function ServiceLink({ to, title, text }) {
  return <Link className="settings-service-link" to={to}><strong>{title}</strong><span>{text}</span><b>Открыть →</b></Link>;
}
