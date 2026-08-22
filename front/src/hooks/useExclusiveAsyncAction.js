import { useCallback, useRef, useState } from "react";

import useMountedRef from "./useMountedRef";

export default function useExclusiveAsyncAction() {
  const active = useRef(null);
  const mounted = useMountedRef();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    (action) => {
      if (active.current) return active.current;
      if (mounted.current) setPending(true);
      active.current = Promise.resolve()
        .then(action)
        .finally(() => {
          active.current = null;
          if (mounted.current) setPending(false);
        });
      return active.current;
    },
    [mounted]
  );
  return { pending, run };
}
