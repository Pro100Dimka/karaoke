import { Mic } from "lucide-react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel } from "../components/ui";

const REACT_VERSION = "18.3.1";

export default function About() {
  const { data: about } = usePolling(api.getAbout, 10000, []);

  return (
    <Panel>
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div
          style={{
            width: 80, height: 80, margin: "0 auto 16px", borderRadius: "50%",
            background: "var(--accent-gradient)", display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Mic size={36} color="#fff" />
        </div>
        <h1 style={{ margin: "0 0 4px" }}>Karaoke Studio</h1>
        <p className="text-secondary">Инструмент для создания и исполнения караоке с AI-анализом голоса</p>

        <div style={{ display: "inline-block", textAlign: "left", marginTop: 24, fontSize: 13 }}>
          <Row label="Версия Backend" value={about?.backend_version || "—"} />
          <Row label="Версия React" value={REACT_VERSION} />
          <Row label="Версия AI" value={about?.ai_version || "—"} />
          <Row label="Путь к данным" value={about?.data_dir || "—"} />
        </div>

        <p className="text-muted" style={{ fontSize: 12, marginTop: 24 }}>© 2026 Karaoke Studio</p>
      </div>
    </Panel>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 40, padding: "4px 0" }}>
      <span className="text-muted">{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}
