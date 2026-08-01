import { useEffect, useState } from "react";
import { ArrowLeft, Check, Cpu, FolderCog, Palette, Save, Settings2, Wrench } from "lucide-react";
import { api } from "../api/client";
import { Panel } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { useAppDialog } from "../components/AppDialog";
import ModelManager from "./ModelManager";
import MemoryManager from "./MemoryManager";
import Diagnostics from "./Diagnostics";
import History from "./History";
import About from "./About";

const TABS = [
  { id: "appearance", label: "Интерфейс", icon: Palette },
  { id: "ai", label: "AI и обработка", icon: Cpu },
  { id: "storage", label: "Файлы", icon: FolderCog },
  { id: "service", label: "Обслуживание", icon: Wrench },
];

export default function Settings() {
  const { alert: notify } = useAppDialog();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState("appearance");
  const [serviceView, setServiceView] = useState(null);

  useEffect(() => {
    api.getAppSettings().then(setForm).catch((err) => notify(`Не удалось загрузить настройки: ${err.message}`));
  }, [notify]);
  useEffect(() => {
    if (form?.theme) document.documentElement.dataset.theme = form.theme;
  }, [form?.theme]);

  if (!form) return <Panel title="Настройки программы"><p className="text-muted">Загружаем центр управления…</p></Panel>;

  const set = (field) => (value) => {
    if (field === "theme") {
      document.documentElement.dataset.theme = value;
      window.localStorage.setItem("karaoke-theme", value);
    }
    setSaved(false);
    setForm((state) => ({ ...state, [field]: value }));
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.updateAppSettings(form);
      setSaved(true);
    } catch (err) {
      await notify(`Не удалось сохранить: ${err.message}`);
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

        <Panel className="settings-content-panel" title={serviceView ? "Обслуживание" : TABS.find((item) => item.id === tab)?.label}>
          {serviceView ? <ServiceScreen view={serviceView} onBack={() => setServiceView(null)} /> : <>
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
                <Dropdown value={form.whisper_model} onChange={set("whisper_model")} options={["tiny", "base", "small", "medium", "large", "turbo", "large-v3-turbo"].map((value) => ({ value, label: value }))} />
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
              <ServiceLink view="models" onOpen={setServiceView} title="Модели AI" text="Загрузка и выбор моделей распознавания" />
              <ServiceLink view="memory" onOpen={setServiceView} title="Хранилище" text="Кэш, свободное место и очистка" />
              <ServiceLink view="history" onOpen={setServiceView} title="История" text="События и действия в приложении" />
              <ServiceLink view="diagnostics" onOpen={setServiceView} title="Диагностика" text="Проверка компонентов и окружения" />
              <ServiceLink view="about" onOpen={setServiceView} title="О программе" text="Версия и сведения о приложении" />
            </div>
          )}
          </>}
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
function ServiceLink({ view, onOpen, title, text }) {
  return <button type="button" className="settings-service-link" onClick={() => onOpen(view)}><strong>{title}</strong><span>{text}</span><b>Открыть →</b></button>;
}

function ServiceScreen({ view, onBack }) {
  const screens = { models: ModelManager, memory: MemoryManager, diagnostics: Diagnostics, history: History, about: About };
  const Screen = screens[view];
  return <div className="settings-service-screen"><button type="button" className="btn btn-ghost settings-service-back" onClick={onBack}><ArrowLeft size={15} /> Назад к настройкам</button><Screen /></div>;
}
