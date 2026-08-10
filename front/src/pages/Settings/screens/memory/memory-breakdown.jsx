import { Card, Grid, Stack, Typography } from "../../../../theme/ui";
import { MEMORY_SECTIONS } from "./config";
import { formatBytes } from "./format";

export default function MemoryBreakdown({ breakdown = {} }) {
  return (
    <Grid minItemWidth="min(100%, 14rem)" gap="var(--space-3)">
      {Object.entries(breakdown).map(([key, bytes]) => (
        <Card
          key={key}
          as="article"
          variant="animation"
          tilt={false}
          cardContent={{ style: { padding: "1rem" } }}
        >
          <Stack gap={0.35}>
            <Typography variant="caption" tone="muted">
              {MEMORY_SECTIONS[key] ?? key}
            </Typography>

            <Typography variant="h3">{formatBytes(bytes)}</Typography>
          </Stack>
        </Card>
      ))}
    </Grid>
  );
}
