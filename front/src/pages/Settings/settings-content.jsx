import { ArrowLeft } from "lucide-react";
import { useRadio } from "../../contexts/radio";
import { Button, ConfigForm, Stack } from "../../theme/ui";
import useAudioSettingsSource from "./audio-source";
import { SCREEN_BY_ID, SETTINGS } from "./config";
import { SETTINGS_RENDERERS } from "./renderers";

function ServiceContent({ service, onOpen, onClose }) {
  const ServiceScreen = SCREEN_BY_ID[service]?.component;
  if (ServiceScreen) {
    return (
      <Stack className="settings-service-screen" gap={2}>
        <Button variant="ghost" onClick={onClose}>
          <ArrowLeft size={16} />
          Назад
        </Button>
        <ServiceScreen />
      </Stack>
    );
  }
  return (
    <Stack className="settings-service-grid u-grid-2" gap={2}>
      {SETTINGS.service.screens.map(({ id, title, text }) => (
        <Button
          key={id}
          className="settings-service-link"
          onClick={() => onOpen(id)}
        >
          <Stack align="start" gap={1}>
            <strong>{title}</strong>

            <span>{text}</span>

            <b>Открыть →</b>
          </Stack>
        </Button>
      ))}
    </Stack>
  );
}

export default function SettingsContent({
  tab,
  service,
  form,
  onChange,
  onFieldBlur,
  onOpenService,
  onCloseService
}) {
  const radio = useRadio();
  const audio = useAudioSettingsSource();
  if (tab === "service") {
    return (
      <ServiceContent
        service={service}
        onOpen={onOpenService}
        onClose={onCloseService}
      />
    );
  }
  const section = SETTINGS[tab];
  if (!section) return null;
  return (
    <ConfigForm
      fields={section.fields}
      className={section.className}
      context={{ form, radio, audio, onChange, onFieldBlur }}
      renderers={SETTINGS_RENDERERS}
      sx={{ padding: "0 1rem" }}
    />
  );
}
