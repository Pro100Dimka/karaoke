import Button from "../../components/fields/button";
import { SETTINGS_TABS } from "./config";

export default function SettingsTabs({ value, onChange }) {
  return (
    <nav className="settings-tabs" aria-label="Разделы настроек">
      {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          unstyled
          className={value === id ? "is-active" : ""}
          onClick={() => onChange(id)}
        >
          <Icon size={17} />
          <span>{label}</span>
        </Button>
      ))}
    </nav>
  );
}
