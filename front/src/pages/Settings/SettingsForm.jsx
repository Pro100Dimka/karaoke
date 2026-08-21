import { Volume2 } from "lucide-react";
import { translateSaved as tr } from "../../i18n/runtime";
import { Button, ConfigForm, Progress, Stack, Switch, Typography } from "../../theme/ui";
import { bindField } from "./bindings";
import { FIELDS } from "./schema";

const cleanButtonProps = (props) => {
  const clean = { ...props };
  delete clean.label;
  delete clean.tooltip;
  return clean;
};

const RENDERERS = {
  speaker: ({ props, context }) => (
    <Button
      {...cleanButtonProps(props)}
      variant="outline"
      startIcon={<Volume2 />}
      disabled={context.audio.busy}
      onClick={context.audio.speaker}
      sx={{ gap: ".6rem", borderRadius: "var(--shape-lg)" }}
    >
      {context.audio.busy ? tr("Проверяем…") : tr("Проверить динамики")}
    </Button>
  ),
  monitor: ({ props, context, value }) => (
    <Stack
      gap={0.35}
      sx={{
        minHeight: "var(--control-md)",
        padding: ".4rem var(--control-pad-md)"
      }}
    >
      <Stack direction="row" align="center" justify="space-between" gap={0.6}>
        <Switch
          {...cleanButtonProps(props)}
          variant="plain"
          label={tr("Слышать свой голос")}
          checked={Boolean(value)}
          disabled={context.audio.busy}
          onChange={context.audio.monitor}
        />
        <Typography variant="caption" tone="muted">
          {value ? tr("Включено") : tr("Выключено")}
        </Typography>
      </Stack>
      <Progress
        size="sm"
        value={value ? context.audio.level : 0}
        aria-label={tr("Уровень микрофона")}
      />
    </Stack>
  )
};

export default function SettingsForm({ tab, settings }) {
  if (!settings.app.form) return null;
  return (
    <ConfigForm
      fields={FIELDS[tab].map((definition) => bindField(settings, definition))}
      context={settings}
      renderers={RENDERERS}
      columns={tab === "ai" ? 6 : 2}
      sx={{ padding: "1rem", maxWidth: "72rem", marginInline: "auto" }}
    />
  );
}
