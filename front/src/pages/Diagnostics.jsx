import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel } from "../components/ui";
import { CheckCircle2, XCircle } from "lucide-react";

function Check({ label, ok }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(168,85,247,0.08)" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {ok ? <CheckCircle2 size={16} color="#22c55e" /> : <XCircle size={16} color="#ef4444" />}
    </div>
  );
}

export default function Diagnostics() {
  const { data: health } = usePolling(api.getHealth, 5000, []);
  const { data: pipeline } = usePolling(api.getPipelineHealth, 5000, []);
  const { data: versions } = usePolling(api.getVersions, 15000, []);
  const { data: errors } = usePolling(api.getErrors, 8000, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      <Panel title="Диагностика">
        <Check label="Backend сервер" ok={!!health} />
        {pipeline && (
          <>
            <Check label="AI Pipeline найден" ok={pipeline.ai_dir_found} />
            <Check label="ffmpeg найден" ok={pipeline.ffmpeg_available} />
            <Check label="Whisper найден" ok={pipeline.whisper_available} />
            <Check label="Demucs найден" ok={pipeline.demucs_available} />
            <Check label="CUDA доступна" ok={pipeline.cuda_available} />
            <Check label="Torch установлен" ok={pipeline.torch_available} />
          </>
        )}

        {versions && (
          <div style={{ marginTop: 18 }}>
            <div className="panel-title" style={{ marginBottom: 8 }}>Версии</div>
            {Object.entries(versions.components).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                <span className="text-muted">{k}</span>
                <span className="mono">{v || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Журнал ошибок">
        {(errors?.errors || []).length === 0 && <p className="text-muted">Ошибок не найдено</p>}
        {(errors?.errors || []).map((e, i) => (
          <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid rgba(239,68,68,0.15)" }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{e.title}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>{e.updated_at}</div>
            <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 2 }}>{e.error_message}</div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
