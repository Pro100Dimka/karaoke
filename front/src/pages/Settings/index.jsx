import { Settings2 } from "lucide-react";
import Button from "../../components/fields/button";
import Modal from "../../components/modal";
import { Panel } from "../../components/ui";
import { useAppDialog } from "../../contexts/AppDialog";
import useSettingsForm from "../../hooks/useSettingsForm";
import useSettingsNavigation from "../../hooks/useSettingsNavigation";
import { SAVE_BUTTONS } from "./config";
import SettingsContent from "./settings-content";
import SettingsTabs from "./settings-tabs";

export default function Settings({
  isOpen = true,
  onClose = () => {},
  initialTab = "audio"
}) {
  const { alert } = useAppDialog();
  const settings = useSettingsForm(alert);
  const navigation = useSettingsNavigation(initialTab);
  const { text, Icon } = SAVE_BUTTONS[settings.saveStatus] ?? SAVE_BUTTONS.idle;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Настройки приложения"
      modalClassName="settings-modal"
      closeClassName="settings-modal-close"
      closeAriaLabel="Закрыть настройки"
      closeIconSize={20}
      portal
      titleProps={{
        className: "settings-header",
        icon: Settings2,
        eyebrow: "НАСТРОЙКИ",
        title: "Настройки приложения",
        description: "Настройте звук, внешний вид и обработку песен под себя.",
        actions: (
          <Button
            icon={Icon}
            variant="primary"
            className="settings-save"
            disabled={settings.saveStatus === "saving"}
            onClick={settings.save}
          >
            {text}
          </Button>
        )
      }}
    >
      <div className="settings-page">
        <div className="settings-layout">
          <SettingsTabs
            value={navigation.tab}
            onChange={navigation.selectTab}
          />
          <Panel className="settings-content-panel">
            {settings.form ? (
              <SettingsContent
                tab={navigation.tab}
                service={navigation.service}
                form={settings.form}
                onChange={settings.updateField}
                onFieldBlur={settings.saveField}
                onOpenService={navigation.openService}
                onCloseService={navigation.closeService}
              />
            ) : (
              <p className="text-muted">Загружаем центр управления…</p>
            )}
          </Panel>
        </div>
      </div>
    </Modal>
  );
}
