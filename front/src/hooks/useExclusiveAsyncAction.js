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

      // Stryker disable next-line ConditionalExpression: inert after unmount.
      if (mountedRef.current) setPending(true);
      const promise = Promise.resolve()
        .then(action)
        .finally(() => {
          activePromiseRef.current = null;
          // Stryker disable next-line ConditionalExpression: inert after unmount.
          if (mountedRef.current) setPending(false);
        });
      activePromiseRef.current = promise;
      return promise;
    },
    // Stryker disable next-line ArrayDeclaration: stable hook-lifetime ref.
    [mountedRef]
  );

  return { pending, run };
}
