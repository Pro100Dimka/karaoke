import { Headphones } from "lucide-react";
import { Button, Progress, Stack } from "../../theme/ui";

export const SETTINGS_RENDERERS = {
  monitor: ({ props, field, context, value }) => (
    <Stack gap={2}>
      <Stack direction="row" align="center" justify="space-between" gap={2}>
        <Stack direction="row" align="center" gap={2}>
          <Headphones size={18} />
          <strong>{field.label}</strong>
        </Stack>
        <Button
          {...props}
          variant={value ? "danger" : "primary"}
          onClick={() => field.run?.(context)}
        >
          {value ? "Выключить" : "Включить"}
        </Button>
      </Stack>
      <Progress value={field.getLevel?.(context) ?? 0} />
    </Stack>
  )
};
