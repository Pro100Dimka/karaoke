import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fetches immediately, then repeats only after the preceding request settles.
 * This avoids overlapping network calls when a local AI operation or an audio
 * driver endpoint responds slower than its polling interval.
 */
export function usePolling(fetchFn, intervalMs, deps = [], options = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const fetchRef = useRef(fetchFn);
  const shouldContinueRef = useRef(options.shouldContinue);
  const shouldRetryErrorRef = useRef(options.shouldRetryError);
  const refreshRef = useRef(null);

  useEffect(() => {
    fetchRef.current = fetchFn;
  }, [fetchFn]);

  useEffect(() => {
    shouldContinueRef.current = options.shouldContinue;
  }, [options.shouldContinue]);

  useEffect(() => {
    shouldRetryErrorRef.current = options.shouldRetryError;
  }, [options.shouldRetryError]);

  useEffect(() => {
    let active = true;
    let timerId = null;
    let inFlight = false;
    let refreshQueued = false;
    const documentRef = globalThis.document;
    const isHidden = () => documentRef?.visibilityState === "hidden";

    const scheduleNext = (result, requestError = null) => {
      const shouldContinue = shouldContinueRef.current;
      const shouldRetryError = shouldRetryErrorRef.current;
      if (
        !active ||
        isHidden() ||
        !Number.isFinite(intervalMs) ||
        intervalMs <= 0 ||
        (requestError &&
          typeof shouldRetryError === "function" &&
          !shouldRetryError(requestError)) ||
        (!requestError &&
          typeof shouldContinue === "function" &&
          !shouldContinue(result))
      )
        return;
      timerId = globalThis.setTimeout(run, intervalMs);
    };

    const run = async () => {
      if (!active) return;
      if (isHidden()) {
        timerId = null;
        refreshQueued = true;
        return;
      }
      if (inFlight) {
        refreshQueued = true;
        return;
      }
      if (timerId) globalThis.clearTimeout(timerId);
      timerId = null;
      inFlight = true;
      let result;
      let requestError = null;
      try {
        result = await fetchRef.current();
        if (active) {
          setData(result);
          setError(null);
        }
      } catch (error) {
        requestError = error;
        if (active) setError(error);
      } finally {
        inFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          run();
        } else {
          scheduleNext(result, requestError);
        }
      }
    };

    refreshRef.current = run;
    run();
    const refreshWhenVisible = () => {
      if (isHidden()) return;
      if (timerId) globalThis.clearTimeout(timerId);
      timerId = null;
      refreshQueued = false;
      run();
    };
    documentRef?.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      refreshQueued = false;
      if (timerId) globalThis.clearTimeout(timerId);
      refreshRef.current = null;
      documentRef?.removeEventListener("visibilitychange", refreshWhenVisible);
    };
    // Callers provide a stable dependency list for the resource being polled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  const refresh = useCallback(() => refreshRef.current?.(), []);
  return { data, error, refresh };
}
