import useDiagnostics from "../../../../hooks/useDiagnostics";
import { Grid, Stack, Typography } from "../../../../theme/ui";
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
    <Stack gap={1.5} className="settings-diagnostics-screen">
      <Stack gap={0.65} className="settings-screen-section">
        <Typography variant="h3">Диагностика</Typography>

        <Grid
          columns={2}
          gap="var(--space-2)"
          className="settings-diagnostics-grid"
        >
          {checks.map(([key, label, ok]) => (
            <DiagnosticCheck key={key} label={label} ok={ok} />
          ))}
        </Grid>
      </Stack>

      <VersionList components={versions?.components} />

      <Stack gap={0.5} className="settings-screen-section">
        <Typography variant="h3">Журнал ошибок</Typography>
        <ErrorList errors={errors?.errors} />
      </Stack>
    </Stack>
  );
}
