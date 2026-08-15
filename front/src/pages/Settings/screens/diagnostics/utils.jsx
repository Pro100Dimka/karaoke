import { useI18n } from "../../../../i18n";
import { Stack, Typography } from "../../../../theme/ui";
import { STATUS_ICONS } from "./config";

export function DiagnosticCheck({ label, ok }) {
  const status = ok ? "success" : "error";
  const Icon = STATUS_ICONS[status];

  return (
    <Stack
      direction="row"
      align="center"
      justify="space-between"
      gap={0.75}
      className="settings-diagnostic-row"
    >
      <Typography variant="body2">{label}</Typography>
      <Icon className={`diagnostics-icon ${status}`} size={18} />
    </Stack>
  );
}

export function VersionList({ components }) {
  const { t } = useI18n();
  const entries = Object.entries(components ?? {});
  if (!entries.length) return null;

  return (
    <Stack gap={0.5} className="settings-screen-section">
      <Typography variant="h3">{t("settings.diagnostics.versions")}</Typography>

      <Stack className="settings-version-list">
        {entries.map(([name, version]) => (
          <Stack
            key={name}
            direction="row"
            align="center"
            justify="space-between"
            gap={1}
            className="settings-version-row"
          >
            <Typography variant="body2" tone="muted">
              {name}
            </Typography>

            <Typography
              variant="body2"
              className="mono"
              sx={{ overflowWrap: "anywhere", textAlign: "right" }}
            >
              {version ?? "—"}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

export const ErrorList = ({ errors = [] }) => {
  const { t } = useI18n();
  return errors.length ? (
    <Stack className="settings-error-list">
      {errors.map((error) => (
        <ErrorItem key={getErrorKey(error)} error={error} />
      ))}
    </Stack>
  ) : (
    <Typography variant="body2" tone="muted" className="settings-empty-line">
      {t("settings.diagnostics.noErrors")}
    </Typography>
  );
};

function ErrorItem({ error }) {
  const { title, updated_at: updatedAt, error_message: message } = error;

  return (
    <Stack gap={0.25} className="settings-error-row">
      <Stack direction="row" align="baseline" justify="space-between" gap={1}>
        <Typography variant="body2">{title}</Typography>
        <Typography variant="caption" tone="muted">
          {updatedAt}
        </Typography>
      </Stack>

      <Typography variant="body2" tone="muted">
        {message}
      </Typography>
    </Stack>
  );
}

export function getErrorKey({ id, updated_at: updatedAt, title }) {
  return id ?? `${updatedAt}-${title}`;
}
