import { useCallback, useRef, useState } from "react";
import { translateSaved } from "../i18n/runtime";
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
  const run = useCallback(
    (action) => {
      if (typeof action !== "function") {
        return Promise.reject(
          new TypeError(translateSaved("Операция очереди должна быть функцией"))
        );
      }
      pendingCountRef.current += 1;
      // Stryker disable next-line ConditionalExpression: inert after unmount.
      if (mountedRef.current) setPending(true);
      const result = tailRef.current.then(() => Promise.resolve().then(action));
      tailRef.current = result.catch(() => {});
      return result.finally(() => {
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
        // Stryker disable next-line ConditionalExpression: inert after unmount.
        if (!mountedRef.current) return;
        if (pendingCountRef.current === 0) {
          setPending(false);
        }
      });
    },
    // Stryker disable next-line ArrayDeclaration: stable hook-lifetime ref.
    [mountedRef]
  );
  return {
    pending,
    run
  };
}
