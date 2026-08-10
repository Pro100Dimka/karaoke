import useDiagnostics from "../../../../hooks/useDiagnostics";
import { Card, Grid, Stack, Typography } from "../../../../theme/ui";
import { PIPELINE_CHECKS } from "./config";
import { DiagnosticCheck, ErrorList, VersionList } from "./utils";

export default function Diagnostics() {
  const { health, pipeline, versions, errors } = useDiagnostics();

  const checks = [
    ["backend", "Backend сервер", Boolean(health)],
    ...(pipeline
      ? PIPELINE_CHECKS.map(([key, label]) => [
          key,
          label,
          Boolean(pipeline[key])
        ])
      : [])
  ];

  return (
    <Grid minItemWidth="min(100%, 24rem)" gap="var(--space-4)">
      <Card
        variant="animation"
        tilt={false}
        className="settings-screen-card"
        cardContent={{ style: { padding: "1.25rem" } }}
      >
        <Stack gap={0.9}>
          <Typography variant="h3">Диагностика</Typography>

          {checks.map(([key, label, ok]) => (
            <DiagnosticCheck key={key} label={label} ok={ok} />
          ))}

          <VersionList components={versions?.components} />
        </Stack>
      </Card>

      <Card
        variant="animation"
        tilt={false}
        className="settings-screen-card"
        cardContent={{ style: { padding: "1.25rem" } }}
      >
        <Stack gap={0.9}>
          <Typography variant="h3">Журнал ошибок</Typography>
          <ErrorList errors={errors?.errors} />
        </Stack>
      </Card>
    </Grid>
  );
}
