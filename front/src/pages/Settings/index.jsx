import { ArrowLeft, Settings2 } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../../i18n";
import { Button, Modal, Stack, Tabs, Typography } from "../../theme/ui";
import ModelStatus from "./ModelStatus";
import { Service, ServiceCards, SERVICE_ICONS } from "./Services";
import SettingsForm from "./SettingsForm";
import { TABS } from "./schema";
import useSettings from "./use-settings";

export default function Settings({ isOpen = true, onClose, initialTab = "appearance" }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(initialTab);
  const [service, setService] = useState(null);
  const settings = useSettings(isOpen);
  const ServiceIcon = SERVICE_ICONS[service];
  const items = TABS.map(([id, label, Icon]) => ({
    value: id,
    label: t(`settings.tab.${id}`, {}, label),
    icon: <Icon size={17} />,
    content: service ? (
      <Service id={service} />
    ) : id === "advanced" ? (
      <ServiceCards open={setService} />
    ) : (
      <Stack gap={1}>
        {settings.app.form ? (
          <SettingsForm tab={id} settings={settings} />
        ) : (
          <Typography tone="muted" sx={{ padding: "1rem" }}>
            {t("settings.loading")}
          </Typography>
        )}
        {id === "ai" && <ModelStatus />}
      </Stack>
    )
  }));
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={t("settings.title")}
      titleProps={{
        icon: ServiceIcon ?? Settings2,
        eyebrow: t("settings.eyebrow"),
        title: service ? t(`settings.service.${service}.title`) : t("settings.title"),
        description: service ? t(`settings.service.${service}.text`) : t("settings.description"),
        actions: service && (
          <Button
            variant="outlined"
            startIcon={<ArrowLeft />}
            onClick={() => setService(null)}
            className="modal-title-action"
          >
            {t("settings.back")}
          </Button>
        )
      }}
    >
      <Tabs
        value={tab}
        onChange={(value) => {
          setTab(value);
          setService(null);
        }}
        items={items}
      />
    </Modal>
  );
}
