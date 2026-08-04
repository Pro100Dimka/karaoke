import { Mic } from "lucide-react";
import { api } from "../../../api/client";
import { usePolling } from "../../../hooks/usePolling";
import { Panel } from "../../../components/ui";

const REACT_VERSION = "18.3.1";

export default function About() {
  const { data: about } = usePolling(api.getAbout, 10000, []);
  const infoRows = [
    { label: "Версия Backend", value: about?.backend_version },
    { label: "Версия React", value: REACT_VERSION },
    { label: "Версия AI", value: about?.ai_version },
    { label: "Путь к данным", value: about?.data_dir },
  ];

  return (
    <Panel>
      <div className="text-center py-8">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[var(--accent-gradient)] flex items-center justify-center">
          <Mic size={36} color="#fff" />
        </div>
        <h1 className="mb-1">Karaoke Studio</h1>
        <p className="text-secondary">
          Инструмент для создания и исполнения караоке с AI-анализом голоса
        </p>

        <div className="inline-block text-left mt-6 text-sm">
          {infoRows.map(({ label, value }) => (
            <Row key={label} label={label} value={value || "—"} />
          ))}
        </div>

        <p className="text-muted text-xs mt-6">© 2026 Karaoke Studio</p>
      </div>
    </Panel>
  );
}

const Row = ({ label, value }) => (
  <div className="flex justify-between gap-10 py-1">
    <span className="text-muted">{label}</span>
    <span className="mono">{value}</span>
  </div>
);
