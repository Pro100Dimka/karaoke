import { useCallback, useRef, useState } from "react";
import useMountedRef from "./useMountedRef";

/**
 * Runs at most one asynchronous action at a time.
 * Repeated calls made before the active action settles reuse its promise.
 */
export default function useExclusiveAsyncAction() {
  const activePromiseRef = useRef(null);
  const mountedRef = useMountedRef();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    (action) => {
      if (activePromiseRef.current) return activePromiseRef.current;

      if (mountedRef.current) setPending(true);
      const promise = Promise.resolve().then(action);
      activePromiseRef.current = promise;

      return promise.finally(() => {
        if (activePromiseRef.current === promise) {
          activePromiseRef.current = null;
          if (mountedRef.current) setPending(false);
        }
      });
    },
    [mountedRef]
  );

  return { pending, run };
}
