import { useEffect, useState } from "react";
import { api } from "../api/client";

export function useAnalysis(recordingId: string | undefined) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null as string | null);

  useEffect(() => {
    if (!recordingId) return;
    let active = true;
    api
      .runAnalysis(recordingId)
      .then((analysis) => active && setResult(analysis))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [recordingId]);

  return { result, error };
}
