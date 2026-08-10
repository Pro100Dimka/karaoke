import { Settings2 } from "lucide-react";

import Modal from "../../components/modal";
import { useAppDialog } from "../../contexts/AppDialog";
import useSettingsForm from "../../hooks/useSettingsForm";
import useSettingsNavigation from "../../hooks/useSettingsNavigation";
import Tabs from "../../theme/ui/Tabs";
import { SETTINGS_TABS } from "./config";
import SettingsContent from "./settings-content";

export default function Settings({
  isOpen = true,
  onClose = () => {},
  initialTab = "appearance"
}) {
  const { alert } = useAppDialog();
  const settings = useSettingsForm(alert);
  const navigation = useSettingsNavigation(initialTab);
  const tabs = SETTINGS_TABS.map(({ id, label, icon: Icon }) => ({
    value: id,
    label,
    icon: <Icon size={17} />,
    content: settings.form ? (
      <SettingsContent
        tab={id}
        service={navigation.service}
        form={settings.form}
        onChange={settings.updateField}
        onFieldBlur={settings.saveField}
        onOpenService={navigation.openService}
        onCloseService={navigation.closeService}
      />
    ) : (
      <p className="text-muted">Загружаем настройки…</p>
    )
  }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="100vw"
      ariaLabel="Настройки приложения"
      titleProps={{
        className: "settings-header",
        icon: Settings2,
        eyebrow: "НАСТРОЙКИ",
        title: "Настройки приложения",
        description: "Настройте звук, внешний вид и обработку песен под себя."
      }}
    >
      <Tabs
        value={navigation.tab}
        onChange={navigation.selectTab}
        aria-label="Разделы настроек"
        items={tabs}
      />
    </Modal>
  );
}
