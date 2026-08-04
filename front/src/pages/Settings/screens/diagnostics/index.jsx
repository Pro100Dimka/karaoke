import { Panel } from "../../../../components/ui";
import useDiagnostics from "../../../../hooks/useDiagnostics";
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
    <div className="grid grid-cols-2 gap-5">
      <Panel title="Диагностика">
        {checks.map(([key, label, ok]) => (
          <DiagnosticCheck key={key} label={label} ok={ok} />
        ))}
        <VersionList components={versions?.components} />
      </Panel>
      <Panel title="Журнал ошибок">
        <ErrorList errors={errors?.errors} />
      </Panel>
    </div>
  );
}
