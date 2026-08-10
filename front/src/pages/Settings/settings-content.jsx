import { ArrowLeft } from "lucide-react";
import { useRadio } from "../../contexts/radio";
import { Button, ConfigForm, Stack } from "../../theme/ui";
import useAudioSettingsSource from "./audio-source";
import { SCREEN_BY_ID, SETTINGS } from "./config";
import { SETTINGS_RENDERERS } from "./renderers";

function ServiceLinks({ screens = [], onOpen }) {
  return (
    <Stack className="settings-service-grid u-grid-2" gap={2}>
      {screens.map(({ id, title, text }) => (
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
  const section = SETTINGS[tab];
  const ServiceScreen = SCREEN_BY_ID[service]?.component;

  if (!section) return null;

  if (ServiceScreen) {
    return (
      <Stack className="settings-service-screen" gap={2}>
        <Button variant="ghost" onClick={onCloseService}>
          <ArrowLeft size={16} />
          Назад
        </Button>
        <ServiceScreen />
      </Stack>
    );
  }

  const context = { form, radio, audio, onChange, onFieldBlur };

  return (
    <Stack gap={3}>
      <ConfigForm
        fields={section.fields}
        className={section.className}
        context={context}
        renderers={SETTINGS_RENDERERS}
        sx={{ padding: "0 1rem" }}
      />

      {section.screens?.length > 0 && (
        <Stack sx={{ padding: "0 1rem" }}>
          <ServiceLinks screens={section.screens} onOpen={onOpenService} />
        </Stack>
      )}
    </Stack>
  );
}
