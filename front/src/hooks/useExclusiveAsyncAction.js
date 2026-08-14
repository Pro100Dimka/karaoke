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

      // Stryker disable next-line ConditionalExpression: React discards post-unmount state updates; the guard is lifecycle hygiene.
      if (mountedRef.current) setPending(true);
      const promise = Promise.resolve()
        .then(action)
        .finally(() => {
          activePromiseRef.current = null;
          // Stryker disable next-line ConditionalExpression: React discards post-unmount state updates; the guard is lifecycle hygiene.
          if (mountedRef.current) setPending(false);
        });
      activePromiseRef.current = promise;
      return promise;
    },
    // Stryker disable next-line ArrayDeclaration: mountedRef has stable identity for the hook lifetime.
    [mountedRef]
  );

  return { pending, run };
}
