import { ArrowLeft } from "lucide-react";

import { useRadio } from "../../contexts/radio";
import {
  Button,
  Card,
  ConfigForm,
  Grid,
  Stack,
  Typography
} from "../../theme/ui";

import useAudioSettingsSource from "./audio-source";
import { SCREEN_BY_ID, SERVICE_SCREENS, SETTINGS } from "./config";
import { SETTINGS_RENDERERS } from "./renderers";

function ServiceContent({ service, onOpen, onClose }) {
  const ServiceScreen = SCREEN_BY_ID[service]?.component;

  if (ServiceScreen) {
    return (
      <Stack className="settings-service-screen" gap={1}>
        <Button variant="ghost" onClick={onClose} sx={{ alignSelf: "start" }}>
          <ArrowLeft size={16} />
          Назад
        </Button>

        <ServiceScreen />
      </Stack>
    );
  }

  return (
    <Grid
      columns={3}
      gap="var(--space-3)"
      sx={{ padding: "0 1rem", paddingTop: "1rem" }}
    >
      {SERVICE_SCREENS.map(({ id, title, text }) => (
        <Card
          key={id}
          as="button"
          type="button"
          variant="animation"
          tilt={false}
          interactive
          className="settings-service-link"
          onClick={() => onOpen(id)}
          sx={{
            width: "100%",
            minWidth: 0,
            padding: 0,
            textAlign: "left",
            cursor: "pointer"
          }}
          cardContent={{
            style: { padding: "1rem 1.1rem", height: "100%" }
          }}
        >
          <Stack
            align="start"
            gap={0.35}
            justify="space-between"
            sx={{ height: "100%" }}
          >
            <Typography variant="body1" sx={{ fontWeight: 800 }}>
              {title}
            </Typography>
            <Typography variant="body2" tone="muted">
              {text}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "var(--ui-primary-hover)" }}
            >
              Открыть →
            </Typography>
          </Stack>
        </Card>
      ))}
    </Grid>
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
  const ServiceScreen = SCREEN_BY_ID[service]?.component;

  if (ServiceScreen) {
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
    <Stack gap={1}>
      <ConfigForm
        fields={section.fields}
        className={section.className}
        context={{ form, radio, audio, onChange, onFieldBlur }}
        renderers={SETTINGS_RENDERERS}
        sx={{ padding: "0 1rem" }}
      />

      {tab === "appearance" && (
        <ServiceContent
          service={null}
          onOpen={onOpenService}
          onClose={onCloseService}
        />
      )}
    </Stack>
  );
}
