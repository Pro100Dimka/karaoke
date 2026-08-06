import { useCallback, useRef, useState } from "react";
import useMountedRef from "./useMountedRef";

/**
 * Serializes asynchronous actions in call order.
 * Useful for settings updates where out-of-order responses would restore an
 * older value after a newer user choice.
 */
export default function useAsyncQueue() {
  const tailRef = useRef(Promise.resolve());
  const mountedRef = useMountedRef();
  const pendingCountRef = useRef(0);
  const [pending, setPending] = useState(false);

  const run = useCallback((action) => {
    pendingCountRef.current += 1;
    if (mountedRef.current) setPending(true);

    const result = tailRef.current.catch(() => {}).then(action);
    tailRef.current = result.catch(() => {});

    return result.finally(() => {
      pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
      if (mountedRef.current && pendingCountRef.current === 0) {
        setPending(false);
      }
    });
  }, [mountedRef]);

  return { pending, run };
}
