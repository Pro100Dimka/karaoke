import { Settings2 } from "lucide-react";

import Modal from "../../components/modal";
import { useAppDialog } from "../../contexts/AppDialog";
import { useI18n } from "../../i18n";
import Tabs from "../../theme/ui/Tabs";
import { SETTINGS_TABS } from "./config";
import useSettingsForm from "./hooks/useSettingsForm";
import useSettingsNavigation from "./hooks/useSettingsNavigation";
import SettingsContent from "./settings-content";

export default function Settings({ isOpen = true, onClose, initialTab = "appearance" }) {
  const { alert } = useAppDialog();
  const { t } = useI18n();
  const settings = useSettingsForm(alert);
  const navigation = useSettingsNavigation(initialTab);
  const tabs = SETTINGS_TABS.map(({ id, label, icon: Icon }) => ({
    value: id,
    label: t(`settings.tab.${id}`, {}, label),
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
      <p className="text-muted">{t("settings.loading")}</p>
    )
  }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="100vw"
      ariaLabel={t("settings.title")}
      titleProps={{
        icon: Settings2,
        eyebrow: t("settings.eyebrow"),
        title: t("settings.title"),
        description: t("settings.description")
      }}
    >
      <Tabs
        value={navigation.tab}
        onChange={navigation.selectTab}
        aria-label={t("settings.sections")}
        items={tabs}
      />
    </Modal>
  );
}
