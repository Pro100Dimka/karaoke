import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fetches immediately, then repeats only after the preceding request settles.
 * This avoids overlapping network calls when a local AI operation or an audio
 * driver endpoint responds slower than its polling interval.
 */
export function usePolling(fetchFn, intervalMs, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const fetchRef = useRef(fetchFn);
  const refreshRef = useRef(null);

  useEffect(() => {
    fetchRef.current = fetchFn;
  }, [fetchFn]);

  useEffect(() => {
    let active = true;
    let timerId = null;
    let inFlight = false;
    const isHidden = () => document.visibilityState === "hidden";

    const scheduleNext = () => {
      if (
        !active ||
        isHidden() ||
        !Number.isFinite(intervalMs) ||
        intervalMs <= 0
      )
        return;
      timerId = window.setTimeout(run, intervalMs);
    };

    const run = async () => {
      if (!active || inFlight || isHidden()) return;
      if (timerId) window.clearTimeout(timerId);
      timerId = null;
      inFlight = true;
      try {
        const result = await fetchRef.current();
        if (active) {
          setData(result);
          setError(null);
        }
      } catch (requestError) {
        if (active) setError(requestError);
      } finally {
        inFlight = false;
        scheduleNext();
      }
    };

    refreshRef.current = run;
    run();
    const refreshWhenVisible = () => {
      if (isHidden()) return;
      if (timerId) window.clearTimeout(timerId);
      timerId = null;
      run();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      if (timerId) window.clearTimeout(timerId);
      refreshRef.current = null;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
    // Callers provide a stable dependency list for the resource being polled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  const refresh = useCallback(() => refreshRef.current?.(), []);
  return { data, error, refresh };
}
