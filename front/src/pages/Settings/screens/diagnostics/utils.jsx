import { STATUS_ICONS } from "./config";

export function DiagnosticCheck({ label, ok }) {
  const status = ok ? "success" : "error";
  const Icon = STATUS_ICONS[status];
  return (
    <div className="diagnostics-check u-surface-card">
      <span>{label}</span>
      <Icon className={`diagnostics-icon ${status}`} />
    </div>
  );
}
export function VersionList({ components }) {
  const entries = Object.entries(components ?? {});
  if (!entries.length) return null;
  return (
    <div className="diagnostics-versions u-stack-2">
      <div className="panel-title diagnostics-versions-title">Версии</div>
      {entries.map(([name, version]) => (
        <div key={name} className="diagnostics-version-row">
          <span className="text-muted">{name}</span>
          <span className="mono">{version ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}
export const ErrorList = ({ errors = [] }) =>
  errors.length ? (
    errors.map((error) => <ErrorItem key={getErrorKey(error)} error={error} />)
  ) : (
    <p className="text-muted">Ошибок не найдено</p>
  );
function ErrorItem({ error }) {
  const { title, updated_at: updatedAt, error_message: message } = error;
  return (
    <div className="diagnostics-error-item">
      <div className="diagnostics-error-title">{title}</div>
      <div className="diagnostics-error-meta text-muted">{updatedAt}</div>
      <div className="diagnostics-error-message">{message}</div>
    </div>
  );
}

const getErrorKey = ({ id, updated_at: updatedAt, title }) =>
  id ?? `${updatedAt}-${title}`;
