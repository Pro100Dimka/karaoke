import { Card, Stack, Typography } from "../../../../theme/ui";
import { STATUS_ICONS } from "./config";

export function DiagnosticCheck({ label, ok }) {
  const status = ok ? "success" : "error";
  const Icon = STATUS_ICONS[status];

  return (
    <Card
      as="div"
      surface="soft"
      className="settings-diagnostic-row"
      sx={{ width: "100%" }}
    >
      <Stack
        direction="row"
        align="center"
        justify="space-between"
        gap={0.75}
        sx={{ padding: ".8rem 1rem" }}
      >
        <Typography variant="body2">{label}</Typography>
        <Icon className={`diagnostics-icon ${status}`} size={18} />
      </Stack>
    </Card>
  );
}

export function VersionList({ components }) {
  const entries = Object.entries(components ?? {});
  if (!entries.length) return null;

  return (
    <Stack gap={0.65}>
      <Typography variant="h3">Версии</Typography>

      {entries.map(([name, version]) => (
        <Card
          key={name}
          as="div"
          surface="soft"
          className="settings-diagnostic-row"
          sx={{ width: "100%" }}
        >
          <Stack
            direction="row"
            align="center"
            justify="space-between"
            gap={1}
            sx={{ padding: ".75rem 1rem" }}
          >
            <Typography variant="body2" tone="muted">
              {name}
            </Typography>

            <Typography variant="body2" className="mono">
              {version ?? "—"}
            </Typography>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

export const ErrorList = ({ errors = [] }) =>
  errors.length ? (
    <Stack gap={0.75}>
      {errors.map((error) => (
        <ErrorItem key={getErrorKey(error)} error={error} />
      ))}
    </Stack>
  ) : (
    <Typography variant="body2" tone="muted">
      Ошибок не найдено
    </Typography>
  );

function ErrorItem({ error }) {
  const { title, updated_at: updatedAt, error_message: message } = error;

  return (
    <Card
      as="div"
      surface="soft"
      className="settings-diagnostic-row"
      sx={{ width: "100%" }}
    >
      <Stack gap={0.3} sx={{ padding: ".85rem 1rem" }}>
        <Typography variant="body2">{title}</Typography>

        <Typography variant="caption" tone="muted">
          {updatedAt}
        </Typography>

        <Typography variant="body2" tone="muted">
          {message}
        </Typography>
      </Stack>
    </Card>
  );
}

const getErrorKey = ({ id, updated_at: updatedAt, title }) =>
  id ?? `${updatedAt}-${title}`;
