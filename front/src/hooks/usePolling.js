import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { queryClient } from "../query-client";

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

const isHidden = () => globalThis.document?.visibilityState === "hidden";

export function usePolling(fetchFn, intervalMs, deps = [], options = {}) {
  const id = useId();
  const latest = useRef();
  const refreshState = useRef({});
  const [hidden, setHidden] = useState(isHidden);
  latest.current = { fetchFn, ...options };

  const query = useQuery(
    {
      queryKey: options.queryKey ?? ["poll", id, ...deps],
      queryFn: ({ signal }) => latest.current.fetchFn({ signal }),
      enabled: !hidden,
      refetchInterval: ({ state }) =>
        shouldSchedulePoll({
          active: true,
          hidden,
          intervalMs,
          result: state.data,
          error: state.error,
          ...latest.current
        })
          ? intervalMs
          : false,
      retry: false
    },
    queryClient
  );
  const refresh = useCallback(() => {
    const state = refreshState.current;
    if (state.inFlight) {
      state.queued = true;
      return state.inFlight;
    }
    const run = async () => {
      let result;
      do {
        state.queued = false;
        result = await query.refetch({ cancelRefetch: false });
      } while (state.queued);
      return result.data;
    };
    state.inFlight = run().finally(() => {
      state.inFlight = null;
    });
    return state.inFlight;
  }, [query.refetch]);

  useEffect(() => {
    const page = globalThis.document;
    const update = () => {
      const next = isHidden();
      setHidden(next);
      if (!next) refresh();
    };
    page?.addEventListener("visibilitychange", update);
    return () => page?.removeEventListener("visibilitychange", update);
  }, [refresh]);

  return { data: query.data ?? null, error: query.error ?? null, refresh };
}
