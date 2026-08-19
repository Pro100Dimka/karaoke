import { useEffect, useRef, useState } from "react";

export default function useAction({
  action,
  state,
  successDuration = 1200,
  errorDuration = 1800
}) {
  const controlled = state != null;
  const [internalState, setInternalState] = useState("idle");
  const timerRef = useRef();
  const runRef = useRef(0);
  const abortRef = useRef();
  const currentState = controlled ? state : internalState;

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    abortRef.current?.abort();
  }, []);

  const settle = (next, delay) => {
    if (controlled) return;
    clearTimeout(timerRef.current);
    setInternalState(next);
    timerRef.current = setTimeout(() => setInternalState("idle"), delay);
  };

  const run = async payload => {
    if (!action || currentState === "loading") return;

    const runId = ++runRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!controlled) setInternalState("loading");

    try {
      const result = await action(payload, controller.signal);

      if (runId === runRef.current && !controller.signal.aborted)
        settle("success", successDuration);

      return result;
    } catch (error) {
      if (
        runId === runRef.current &&
        !controller.signal.aborted &&
        error?.name !== "AbortError"
      ) settle("error", errorDuration);

      throw error;
    }
  };

  return {
    state: currentState,
    busy: currentState === "loading",
    run,
    cancel: () => abortRef.current?.abort()
  };
}
