import { Trash2 } from "lucide-react";
import { translateSaved } from "../../../../i18n/runtime";
import { Button, Grid, Select, Stack, Typography } from "../../../../theme/ui";
import SettingsMetricGrid from "../../settings-metric-grid";
import { getErrorMessage } from "../../../../utils/errors";

export async function runMemoryAction({ request, getMessage, notify }) {
  try {
    const result = await request();
    await notify(getMessage(result));
    return true;
  } catch (error) {
    await notify(getErrorMessage(error, translateSaved("Не удалось выполнить действие")));
    return false;
  }
}
export function MemoryStats({ size, free }) {
  const items = [
    [translateSaved("Всего занято"), size?.total_human ?? "—"],
    ...(free
      ? [
          [
            translateSaved("Свободно на диске"),
            translateSaved("{0} из {1}", { 0: free.free_human, 1: free.total_human })
          ]
        ]
      : [])
  ];
  return <SettingsMetricGrid items={items} />;
}
export function MemoryActions({ actions, notify }) {
  return (
    <Stack direction="row" gap={0.75} wrap className="settings-memory-actions">
      {actions.map(([id, label, icon, variant, request, getMessage]) => {
        const Icon = icon;
        return (
          <Button
            key={id}
            variant={variant === "ghost" ? "outline" : "solid"}
            tone="primary"
            onClick={() => runMemoryAction({ request, getMessage, notify })}
          >
            {Icon && <Icon size={15} />}
            {label}
          </Button>
        );
      })}
    </Stack>
  );
}
export function OptimizeSong({ value, options, onChange, onOptimize }) {
  return (
    <Stack gap={0.65} className="settings-screen-section settings-optimize-section">
      <Typography variant="body2">{translateSaved("Оптимизация песни")}</Typography>

      <Grid columns={2} gap="var(--space-3)" sx={{ alignItems: "end" }}>
        <Select
          label={translateSaved("Песня")}
          value={value}
          options={options}
          onChange={onChange}
        />

        <Button variant="outline" disabled={!value} onClick={onOptimize}>
          <Trash2 size={15} />
          {translateSaved("Оптимизировать")}
        </Button>
      </Grid>
    </Stack>
  );
}
