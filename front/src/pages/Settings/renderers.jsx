import { Volume2 } from "lucide-react";
import { Button, Progress, Stack } from "../../theme/ui";

const buttonProps = (props = {}) => {
  const clean = { ...props };
  ["label", "tooltip", "startIcon", "fieldSx"].forEach((key) => delete clean[key]);
  return clean;
};

export const SETTINGS_RENDERERS = {
  action: ({ field, context }) => {
    const pending = field.isPending?.(context) ?? false;

    return (
      <Button startIcon={Volume2} onClick={() => field.run?.(context)}>
        {pending ? field.pendingText : (field.idleText ?? field.label)}
      </Button>
    );
  },

  monitor: ({ props, field, context, value }) => {
    const { t } = context;
    return (
      <Stack className="settings-audio-monitor" gap={0.4}>
        <Button {...buttonProps(props)} onClick={() => field.run?.(context)}>
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
