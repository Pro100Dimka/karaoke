import { api } from "../../../../api/client";
import { usePolling } from "../../../../hooks/usePolling";
import { POLLING_INTERVALS } from "../../../../runtime-config";

export default function useDiagnostics() {
  const { data: health } = usePolling(api.getHealth, POLLING_INTERVALS.health, []);
  const { data: pipeline } = usePolling(api.getPipelineHealth, POLLING_INTERVALS.health, []);
  const { data: versions } = usePolling(api.getVersions, POLLING_INTERVALS.versions, []);
  const { data: errors } = usePolling(api.getErrors, POLLING_INTERVALS.errors, []);
  return { health, pipeline, versions, errors };
}
