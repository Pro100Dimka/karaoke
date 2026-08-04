import { CheckCircle2, XCircle } from "lucide-react";
import { api } from "../../../api/client";
import { Panel } from "../../../components/ui";
import { usePolling } from "../../../hooks/usePolling";

function Check({ label, ok }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid rgba(168,85,247,0.08)"
      }}
    >
      <span style={{ fontSize: 13 }}>{label}</span>
      {ok ? (
        <CheckCircle2 size={16} color="#22c55e" />
      ) : (
        <XCircle size={16} color="#ef4444" />
      )}
    </div>
  );
}
function Versions({ components }) {
  return (
    <div className="mt-4">
      <div className="panel-title mb-2">Версии</div>
      {Object.entries(components).map(([k, v]) => (
        <div key={k} className="flex justify-between text-xs py-1">
          <span className="text-muted">{k}</span>
          <span className="mono">{v || "—"}</span>
        </div>
      ))}
    </div>
  );
}
function ErrorLog({ errors }) {
  if (!errors || errors.length === 0) {
    return <p className="text-muted">Ошибок не найдено</p>;
  }

  return errors.map((e, i) => (
    <div key={i} className="py-2 border-b border-red-500/20">
      <div className="font-semibold text-sm">{e.title}</div>
      <div className="text-muted text-xs">{e.updated_at}</div>
      <div className="text-red-400 text-xs mt-1">{e.error_message}</div>
    </div>
  ));
}

export default function Diagnostics() {
  const { data: health } = usePolling(api.getHealth, 5000, []);
  const { data: pipeline } = usePolling(api.getPipelineHealth, 5000, []);
  const { data: versions } = usePolling(api.getVersions, 15000, []);
  const { data: errors } = usePolling(api.getErrors, 8000, []);

  const pipelineChecks = [
    { label: "AI Pipeline найден", key: "ai_dir_found" },
    { label: "ffmpeg найден", key: "ffmpeg_available" },
    { label: "Whisper найден", key: "whisper_available" },
    { label: "Demucs найден", key: "demucs_available" },
    { label: "CUDA доступна", key: "cuda_available" },
    { label: "Torch установлен", key: "torch_available" }
  ];

  return (
    <div className="grid grid-cols-2 gap-5">
      <Panel title="Диагностика">
        <Check label="Backend сервер" ok={!!health} />
        {pipeline &&
          pipelineChecks.map(({ label, key }) => (
            <Check key={key} label={label} ok={pipeline[key]} />
          ))}
        {versions && <Versions components={versions.components} />}
      </Panel>

      <Panel title="Журнал ошибок">
        <ErrorLog errors={errors?.errors || []} />
      </Panel>
    </div>
  );
}
