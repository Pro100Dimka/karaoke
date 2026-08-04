import { STATUS_ICONS } from "./config";

export function DiagnosticCheck({ label, ok }) {
  const status = ok ? "success" : "error";
  const Icon = STATUS_ICONS[status];
  return (
    <div className="diagnostics-check">
      <span>{label}</span>
      <Icon className={`diagnostics-icon ${status}`} />
    </div>
  );
}
export function VersionList({ components }) {
  const entries = Object.entries(components ?? {});
  if (!entries.length) return null;
  return (
    <div className="mt-4">
      <div className="panel-title mb-2">Версии</div>
      {entries.map(([name, version]) => (
        <div key={name} className="flex justify-between text-xs py-1">
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
    <div className="py-2 border-b border-red-500/20">
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-muted text-xs">{updatedAt}</div>
      <div className="text-red-400 text-xs mt-1">{message}</div>
    </div>
  );
}

const getErrorKey = ({ id, updated_at: updatedAt, title }) =>
  id ?? `${updatedAt}-${title}`;
