import { Settings2 } from "lucide-react";
import { SAVE_BUTTONS } from "./config";

export default function SettingsHeader({ status, onSave }) {
  const { text, Icon } = SAVE_BUTTONS[status] ?? SAVE_BUTTONS.idle;
  return (
    <section className="settings-hero">
      <div className="settings-hero-icon">
        <Settings2 size={28} />
      </div>

      <div className="settings-hero-content">
        <span>КОНТРОЛЬНЫЙ ЦЕНТР</span>
        <h1>Настройки приложения</h1>
        <p>Персонализируйте студию, обработку и рабочее пространство.</p>
      </div>

      <button
        type="button"
        className="btn btn-primary settings-save"
        disabled={status === "saving"}
        onClick={onSave}
      >
        <Icon size={16} />
        {text}
      </button>
    </section>
  );
}
