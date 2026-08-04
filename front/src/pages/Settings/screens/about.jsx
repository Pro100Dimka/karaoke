import { Mic } from "lucide-react";
import { api } from "../../../api/client";
import { Panel } from "../../../components/ui";
import { usePolling } from "../../../hooks/usePolling";
import { APP_INFO } from "../../../utils/config";

const INFO_FIELDS = [
  ["backend_version", "Версия Backend"],
  ["frontend_version", "Версия React"],
  ["ai_version", "Версия AI"],
  ["data_dir", "Путь к данным"]
];
export default function About() {
  const { data } = usePolling(api.getAbout, 10000, []);
  const about = data ?? {};
  return (
    <Panel>
      <div className="text-center py-8">
        <div className="about-logo">
          <Mic size={36} />
        </div>
        <h1 className="mb-1">{APP_INFO.title}</h1>
        <p className="text-secondary">{APP_INFO.description}</p>
        <div className="inline-block text-left mt-6 text-sm">
          {INFO_FIELDS.map(([key, label]) => (
            <div key={key} className="flex justify-between gap-10 py-1">
              <span className="text-muted">{label}</span>
              <span className="mono">{about[key] ?? "—"}</span>
            </div>
          ))}
        </div>
        <p className="text-muted text-xs mt-6">{APP_INFO.copyright}</p>
      </div>
    </Panel>
  );
}
