import { Trash2 } from "lucide-react";

import { Button, Grid, Select, Stack, Typography } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";

export async function runMemoryAction({ request, getMessage, notify }) {
  try {
    const result = await request();
    await notify(getMessage(result));
    return true;
  } catch (error) {
    await notify(getErrorMessage(error, "Не удалось выполнить действие"));
    return false;
  }
}

export function MemoryStats({ size, free }) {
  const items = [
    ["Всего занято", size?.total_human ?? "—"],
    ...(free
      ? [["Свободно на диске", `${free.free_human} из ${free.total_human}`]]
      : [])
  ];

  return (
    <Grid
      minItemWidth="min(100%, 13rem)"
      gap="var(--space-2)"
      className="settings-metric-grid"
    >
      {items.map(([label, value]) => (
        <Stack key={label} gap={0.2} className="settings-metric-item">
          <Typography variant="caption" tone="muted">
            {label}
          </Typography>

          <Typography variant="h3">{value}</Typography>
        </Stack>
      ))}
    </Grid>
  );
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
    <Stack
      gap={0.65}
      className="settings-screen-section settings-optimize-section"
    >
      <Typography variant="body2">Оптимизация песни</Typography>

      <Grid columns={2} gap="var(--space-3)" sx={{ alignItems: "end" }}>
        <Select
          label="Песня"
          value={value}
          options={options}
          onChange={onChange}
        />

        <Button variant="outline" disabled={!value} onClick={onOptimize}>
          <Trash2 size={15} />
          Оптимизировать
        </Button>
      </Grid>
    </Stack>
  );
}
