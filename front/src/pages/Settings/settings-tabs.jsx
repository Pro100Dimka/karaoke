import { SETTINGS_TABS } from "./config";

export default function SettingsTabs({ value, onChange }) {
  return (
    <nav className="settings-tabs" aria-label="Разделы настроек">
      {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={value === id ? "is-active" : ""}
          onClick={() => onChange(id)}
        >
          <Icon size={17} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
