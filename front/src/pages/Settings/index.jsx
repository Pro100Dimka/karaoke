import { Panel } from "../../components/ui";
import { useAppDialog } from "../../contexts/AppDialog";
import useSettingsForm from "../../hooks/useSettingsForm";
import useSettingsNavigation from "../../hooks/useSettingsNavigation";
import { SETTINGS } from "./config";
import SettingsHeader from "./header";
import { SettingsTabs } from "./screens";
import SettingsContent from "./settings-content";

export default function Settings() {
  const { alert } = useAppDialog();
  const settings = useSettingsForm(alert);
  const navigation = useSettingsNavigation();

  return (
    <div className="settings-page">
      <SettingsHeader status={settings.saveStatus} onSave={settings.save} />
      <div className="settings-layout">
        <SettingsTabs value={navigation.tab} onChange={navigation.selectTab} />
        <Panel
          className="settings-content-panel"
          title={SETTINGS[navigation.tab]?.label}
        >
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
  );
}
