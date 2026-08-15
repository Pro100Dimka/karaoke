import SettingsMetricGrid from "../../settings-metric-grid";
import { MEMORY_SECTIONS } from "./config";
import { formatBytes } from "./format";

export default function MemoryBreakdown({ breakdown = {} }) {
  return (
    <SettingsMetricGrid
      items={Object.entries(breakdown).map(([key, bytes]) => [
        MEMORY_SECTIONS[key] ?? key,
        formatBytes(bytes)
      ])}
    />
  );
}
