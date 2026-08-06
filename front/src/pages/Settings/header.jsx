import { Settings2 } from "lucide-react";
import Button from "../../components/fields/button";
import ModalTitle from "../../components/modal/title";
import { SAVE_BUTTONS } from "./config";

export default function SettingsHeader({ status, onSave }) {
  const { text, Icon } = SAVE_BUTTONS[status] ?? SAVE_BUTTONS.idle;

  return (
    <ModalTitle
      className="settings-header"
      icon={Settings2}
      eyebrow="КОНТРОЛЬНЫЙ ЦЕНТР"
      title="Настройки приложения"
      description="Персонализируйте студию, обработку и рабочее пространство."
      actions={
        <Button
          icon={Icon}
          variant="primary"
          className="settings-save"
          disabled={status === "saving"}
          onClick={onSave}
        >
          {text}
        </Button>
      }
    />
  );
}
