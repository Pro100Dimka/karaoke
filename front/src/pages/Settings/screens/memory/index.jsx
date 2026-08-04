import { useState } from "react";
import { api } from "../../../../api/client";
import { Panel } from "../../../../components/ui";
import { useAppDialog } from "../../../../contexts/AppDialog";
import { usePolling } from "../../../../hooks/usePolling";
import { buildOptimizeOptions, MEMORY_ACTIONS } from "./config";
import MemoryBreakdown from "./memory-breakdown";
import {
  MemoryActions,
  MemoryStats,
  OptimizeSong,
  runMemoryAction
} from "./utils";

export default function MemoryManager() {
  const { alert: notify } = useAppDialog();
  const { data: size, error } = usePolling(api.getCacheSize, 5000, []);
  const { data: free } = usePolling(api.getFreeSpace, 10000, []);
  const { data: songs } = usePolling(api.listSongs, 8000, []);
  const [optimizeTarget, setOptimizeTarget] = useState("");
  const optimizeOptions = buildOptimizeOptions(songs ?? []);
  const handleOptimize = async () => {
    if (!optimizeTarget) return;
    const success = await runMemoryAction({
      request: () => api.optimizeSong(optimizeTarget),
      getMessage: ({ freed_human: freedHuman }) =>
        `Освобождено: ${freedHuman ?? "—"}`,
      notify
    });
    if (success) setOptimizeTarget("");
  };
  const sections = [
    ["breakdown", MemoryBreakdown, { breakdown: size?.breakdown }],
    ["stats", MemoryStats, { size, free }],
    ["actions", MemoryActions, { actions: MEMORY_ACTIONS, notify }],
    [
      "optimize",
      OptimizeSong,
      {
        value: optimizeTarget,
        options: optimizeOptions,
        onChange: setOptimizeTarget,
        onOptimize: handleOptimize
      }
    ]
  ];
  return (
    <Panel title="Управление памятью">
      {error && <p style={{ color: "var(--danger)" }}>{error.message}</p>}
      {size &&
        sections.map(([id, Component, props]) => (
          <Component key={id} {...props} />
        ))}
    </Panel>
  );
}
