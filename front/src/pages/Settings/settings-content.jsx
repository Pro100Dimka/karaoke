import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../api/client";
import { useRadio } from "../../contexts/radio";
import {
  Button,
  Card,
  ConfigForm,
  Grid,
  Stack,
  Typography
} from "../../theme/ui";
import { readJsonStorage } from "../../utils/storage";
import { persistUiPreferences } from "../../utils/ui-preferences";

import useAudioSettingsSource from "./audio-source";
import { SCREEN_BY_ID, SERVICE_SCREENS, SETTINGS } from "./config";
import { SETTINGS_RENDERERS } from "./renderers";

function ServiceContent({ service, onOpen, onClose }) {
  const ServiceScreen = SCREEN_BY_ID[service]?.component;

  if (ServiceScreen) {
    return (
      <Stack
        className="settings-service-screen"
        gap={1.25}
        sx={{ padding: "1rem" }}
      >
        <Button
          variant="ghost"
          onClick={onClose}
          sx={{ alignSelf: "start", paddingInline: ".5rem" }}
        >
          <Stack direction="row" align="center" gap={0.5}>
            <ArrowLeft size={16} />
            <span>Назад</span>
          </Stack>
        </Button>

        <ServiceScreen />
      </Stack>
    );
  }

  return (
    <Grid columns={2} gap="var(--space-3)" sx={{ padding: "1rem" }}>
      {SERVICE_SCREENS.map(({ id, title, text }) => (
        <Card
          key={id}
          as="button"
          type="button"
          variant="animation"
          tilt={false}
          interactive
          className="settings-service-link settings-neon-card"
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
  const [showAdvancedAudio, setShowAdvancedAudio] = useState(
    () => readJsonStorage("karaoke-settings-view").showAdvancedAudio ?? false
  );

  useEffect(() => {
    persistUiPreferences(api, "settings", { showAdvancedAudio });
  }, [showAdvancedAudio]);

  const radio = useRadio();
  const audio = useAudioSettingsSource({ enabled: tab === "audio" });
  const ServiceScreen = SCREEN_BY_ID[service]?.component;

  const section = SETTINGS[tab];

  const fields = useMemo(() => {
    if (!section?.fields) return [];

    if (tab !== "audio") return section.fields;

    return section.fields.filter(
      (field) => showAdvancedAudio || !field.advanced
    );
  }, [section, showAdvancedAudio, tab]);

  if (ServiceScreen) {
    return (
      <ServiceContent
        service={service}
        onOpen={onOpenService}
        onClose={onCloseService}
      />
    );
  }

  if (!section) return null;

  return (
    <Stack gap={1}>
      <ConfigForm
        fields={fields}
        className={section.className}
        context={{ form, radio, audio, onChange, onFieldBlur }}
        renderers={SETTINGS_RENDERERS}
        sx={{ padding: "0 1rem" }}
      />

      {tab === "audio" && (
        <Stack
          className="settings-audio-advanced-toggle"
          sx={{ paddingInline: "1rem" }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvancedAudio((value) => !value)}
            aria-expanded={showAdvancedAudio}
          >
            <Stack direction="row" align="center" gap={0.5}>
              <SlidersHorizontal size={15} />
              <span>
                {showAdvancedAudio
                  ? "Скрыть дополнительные настройки"
                  : "Дополнительные настройки"}
              </span>
              {showAdvancedAudio ? (
                <ChevronUp size={15} />
              ) : (
                <ChevronDown size={15} />
              )}
            </Stack>
          </Button>
        </Stack>
      )}

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
