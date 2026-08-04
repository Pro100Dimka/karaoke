import { api } from "../api/client";
import { usePolling } from "./usePolling";

export default function useDiagnostics() {
  const { data: health } = usePolling(api.getHealth, 5000, []);
  const { data: pipeline } = usePolling(api.getPipelineHealth, 5000, []);
  const { data: versions } = usePolling(api.getVersions, 15000, []);
  const { data: errors } = usePolling(api.getErrors, 8000, []);
  return { health, pipeline, versions, errors };
}
