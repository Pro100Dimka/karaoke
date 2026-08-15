import { Headphones, Volume2 } from "lucide-react";
import { Button, Progress, Stack, Typography } from "../../theme/ui";

const buttonProps = (props = {}) => {
  const clean = { ...props };
  ["label", "tooltip", "startIcon", "fieldSx"].forEach( (key) => delete clean[key]
  );
  return clean;
};

export const SETTINGS_RENDERERS = {
  action: ({ props, field, context }) => {
    const { t } = context;
    const pending = field.isPending?.(context) ?? false;

    return (
      <Stack className="settings-audio-action" gap={0.4}>
        <Typography variant="body2" sx={{ fontWeight: 800 }}>
          {t("settings.audio.test")}
        </Typography>

        <Button
          {...buttonProps(props)}
          className="settings-audio-test-button"
          variant="solid"
          onClick={() => field.run?.(context)}
        >
          <Stack direction="row" align="center" justify="center" gap={0.5}>
            <Volume2 size={17} />
            <span>
              {pending ? field.pendingText : (field.idleText ?? field.label)}
            </span>
          </Stack>
        </Button>
      </Stack>
    );
  },

  monitor: ({ props, field, context, value }) => {
    const { t } = context;
    return (
      <Stack className="settings-audio-monitor" gap={0.4}>
        <Stack direction="row" align="center" gap={0.45}>
          <Headphones size={16} aria-hidden="true" />
          <Typography variant="body2" sx={{ fontWeight: 800 }}>
            {field.label}
          </Typography>
        </Stack>

        <Button
          {...buttonProps(props)}
          className="settings-audio-monitor__button"
          variant={value ? "outline" : "solid"}
          tone={value ? "danger" : "primary"}
          onClick={() => field.run?.(context)}
        >
          {t(value ? "settings.audio.monitorOff" : "settings.audio.hearVoice")}
        </Button>

        <Progress
          className="settings-audio-monitor__level"
          value={field.getLevel?.(context) ?? 0}
          aria-label={t("settings.audio.microphoneLevel")}
        />
      </Stack>
    );
  }
};
