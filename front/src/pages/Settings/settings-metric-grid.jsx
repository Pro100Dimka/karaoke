import { Grid, Stack, Typography } from "../../theme/ui";

export default function SettingsMetricGrid({ items }) {
  if (!items?.length) return null;
  return (
    <Grid minItemWidth="min(100%, 13rem)" gap="var(--space-2)" className="settings-metric-grid">
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
