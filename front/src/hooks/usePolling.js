import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fetches immediately, then repeats only after the preceding request settles.
 * This avoids overlapping network calls when a local AI operation or an audio
 * driver endpoint responds slower than its polling interval.
 */
export function shouldSchedulePoll({
  active,
  hidden,
  intervalMs,
  result,
  error,
  shouldContinue,
  shouldRetryError
}) {
  if (!active || hidden || !Number.isFinite(intervalMs) || intervalMs <= 0)
    return false;
  if (error)
    return typeof shouldRetryError !== "function" || shouldRetryError(error);
  return typeof shouldContinue !== "function" || shouldContinue(result);
}

// Stryker disable next-line ArrayDeclaration: omitted dependencies are stable.
export function usePolling(fetchFn, intervalMs, deps = [], options = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const fetchRef = useRef(fetchFn);
  const shouldContinueRef = useRef(options.shouldContinue);
  const shouldRetryErrorRef = useRef(options.shouldRetryError);
  const refreshRef = useRef(null);
  fetchRef.current = fetchFn;
  shouldContinueRef.current = options.shouldContinue;
  shouldRetryErrorRef.current = options.shouldRetryError;

  useEffect(() => {
    let active = true;
    let timerId = null;
    let inFlight = false;
    let refreshQueued = false;
    const documentRef = globalThis.document;
    const isHidden = () => documentRef.visibilityState === "hidden";

    const scheduleNext = (result, requestError = null) => {
      const shouldContinue = shouldContinueRef.current;
      const shouldRetryError = shouldRetryErrorRef.current;
      if (
        !shouldSchedulePoll({
          active,
          hidden: isHidden(),
          intervalMs,
          result,
          error: requestError,
          shouldContinue,
          shouldRetryError
        })
      )
        return;
      timerId = globalThis.setTimeout(run, intervalMs);
    };

    const run = async () => {
      if (!active) return;
      if (isHidden()) {
        timerId = null;
        return;
      }
      if (inFlight) {
        refreshQueued = true;
        return;
      }
      globalThis.clearTimeout(timerId);
      timerId = null;
      inFlight = true;
      let result;
      let requestError = null;
      try {
        result = await fetchRef.current();
        // Stryker disable next-line ConditionalExpression: inert after unmount.
        if (active) {
          setData(result);
          setError(null);
        }
      } catch (error) {
        requestError = error;
        // Stryker disable next-line ConditionalExpression: inert after unmount.
        if (active) setError(error);
      } finally {
        inFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          run();
        } else scheduleNext(result, requestError);
      }
    };

    refreshRef.current = run;
    run();
    const refreshWhenVisible = () => {
      globalThis.clearTimeout(timerId);
      timerId = null;
      refreshQueued = false;
      run();
    };
    documentRef.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      globalThis.clearTimeout(timerId);
      refreshRef.current = null;
      documentRef.removeEventListener("visibilitychange", refreshWhenVisible);
    };
    // Callers provide a stable dependency list for the resource being polled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  const refresh = useCallback(
    () => refreshRef.current?.(),
    // Stryker disable next-line ArrayDeclaration: the callback only dereferences a stable ref.
    []
  );
  return { data, error, refresh };
}
