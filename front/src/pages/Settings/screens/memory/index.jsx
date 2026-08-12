import { useState } from "react";

import { api } from "../../../../api/client";
import { POLLING_INTERVALS } from "../../../../config/runtime";
import { useAppDialog } from "../../../../contexts/AppDialog";
import { usePolling } from "../../../../hooks/usePolling";
import { Stack, Typography } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";
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
  const { data: size, error } = usePolling(
    api.getCacheSize,
    POLLING_INTERVALS.memory,
    []
  );
  const { data: free } = usePolling(
    api.getFreeSpace,
    POLLING_INTERVALS.freeSpace,
    []
  );
  const { data: songs } = usePolling(
    api.listSongs,
    POLLING_INTERVALS.songs,
    []
  );
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

  return (
    <Stack gap={1.4} className="settings-memory-screen">
      <Typography variant="h3">Управление памятью</Typography>

      {error && (
        <Typography variant="body2" sx={{ color: "var(--ui-danger)" }}>
          {getErrorMessage(error)}
        </Typography>
      )}

      {size && (
        <>
          <MemoryBreakdown breakdown={size?.breakdown} />
          <MemoryStats size={size} free={free} />
          <MemoryActions actions={MEMORY_ACTIONS} notify={notify} />
          <OptimizeSong
            value={optimizeTarget}
            options={optimizeOptions}
            onChange={setOptimizeTarget}
            onOptimize={handleOptimize}
          />
        </>
      )}
    </Stack>
  );
}
