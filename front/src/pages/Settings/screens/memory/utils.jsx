import { Trash2 } from "lucide-react";

import {
  Button,
  Card,
  Grid,
  Select,
  Stack,
  Typography
} from "../../../../theme/ui";
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
    <Grid minItemWidth="min(100%, 14rem)" gap="var(--space-3)">
      {items.map(([label, value]) => (
        <Card
          key={label}
          as="div"
          variant="animation"
          tilt={false}
          className="settings-neon-card"
          cardContent={{ style: { padding: "1rem" } }}
        >
          <Stack gap={0.35}>
            <Typography variant="caption" tone="muted">
              {label}
            </Typography>

            <Typography variant="h3">{value}</Typography>
          </Stack>
        </Card>
      ))}
    </Grid>
  );
}

export function MemoryActions({ actions, notify }) {
  return (
    <Stack direction="row" gap={0.75} wrap>
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
    <Card as="div" surface="soft" className="settings-plain-card">
      <Grid
        columns={2}
        gap="var(--space-3)"
        sx={{ alignItems: "end", padding: "1rem" }}
      >
        <Select
          label="Оптимизировать песню"
          value={value}
          options={options}
          onChange={onChange}
        />

        <Button variant="outline" disabled={!value} onClick={onOptimize}>
          <Trash2 size={15} />
          Оптимизировать
        </Button>
      </Grid>
    </Card>
  );
}
