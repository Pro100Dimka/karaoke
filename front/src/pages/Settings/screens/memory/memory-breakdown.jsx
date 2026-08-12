import { Grid, Stack, Typography } from "../../../../theme/ui";
import { MEMORY_SECTIONS } from "./config";
import { formatBytes } from "./format";

export default function MemoryBreakdown({ breakdown = {} }) {
  const entries = Object.entries(breakdown);
  if (!entries.length) return null;

  return (
    <Grid
      minItemWidth="min(100%, 13rem)"
      gap="var(--space-2)"
      className="settings-metric-grid"
    >
      {entries.map(([key, bytes]) => (
        <Stack key={key} gap={0.2} className="settings-metric-item">
          <Typography variant="caption" tone="muted">
            {MEMORY_SECTIONS[key] ?? key}
          </Typography>

          <Typography variant="h3">{formatBytes(bytes)}</Typography>
        </Stack>
      ))}
    </Grid>
  );
}
