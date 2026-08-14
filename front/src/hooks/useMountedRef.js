import { useEffect, useRef } from "react";

/** Keeps a synchronous mounted flag for async callbacks and finalizers. */
export default function useMountedRef() {
  const mountedRef = useRef(true);

  useEffect(
    () => {
      // React Strict Mode intentionally runs setup → cleanup → setup in
      // development. Restore the flag during every setup, not only useRef init.
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    },
    // Stryker disable next-line ArrayDeclaration: a stable injected primitive is also mount-only.
    []
  );

  return mountedRef;
}
