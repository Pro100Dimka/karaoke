import { useCallback, useEffect, useRef, useState } from "react";

export function shouldSchedulePoll({
  active,
  hidden,
  intervalMs,
  result,
  error,
  shouldContinue,
  shouldRetryError
}) {
  if (!active || hidden || !Number.isFinite(intervalMs) || intervalMs <= 0) return false;
  return error
    ? typeof shouldRetryError !== "function" || shouldRetryError(error)
    : typeof shouldContinue !== "function" || shouldContinue(result);
}

export function usePolling(fetchFn, intervalMs, deps = [], options = {}) {
  const [state, setState] = useState({ data: null, error: null });
  const latest = useRef({ fetchFn, ...options });
  const refreshRef = useRef(null);
  latest.current = { fetchFn, ...options };

  useEffect(() => {
    let active = true;
    let timer;
    let inFlight = false;
    let queued = false;
    const page = globalThis.document;
    const hidden = () => page?.visibilityState === "hidden";

    const schedule = (result, error) => {
      if (
        shouldSchedulePoll({
          active,
          hidden: hidden(),
          intervalMs,
          result,
          error,
          ...latest.current
        })
      )
        timer = globalThis.setTimeout(run, intervalMs);
    };
    const run = async () => {
      if (!active || hidden()) return;
      if (inFlight) {
        queued = true;
        return;
      }
      globalThis.clearTimeout(timer);
      timer = undefined;
      inFlight = true;
      let result;
      let error = null;
      try {
        result = await latest.current.fetchFn();
        if (active) setState({ data: result, error: null });
      } catch (reason) {
        error = reason;
        if (active) setState((current) => ({ ...current, error }));
      } finally {
        inFlight = false;
        if (queued) {
          queued = false;
          run();
        } else schedule(result, error);
      }
    };
    const visible = () => {
      globalThis.clearTimeout(timer);
      timer = undefined;
      queued = false;
      run();
    };

    refreshRef.current = run;
    run();
    page?.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      globalThis.clearTimeout(timer);
      refreshRef.current = null;
      page?.removeEventListener("visibilitychange", visible);
    };
    // Resource identity is explicitly supplied by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  const refresh = useCallback(() => refreshRef.current?.(), []);
  return { ...state, refresh };
}
