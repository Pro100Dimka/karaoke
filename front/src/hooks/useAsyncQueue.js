import { useCallback, useRef, useState } from "react";

import { translateSaved as t } from "../i18n/runtime";
import useMountedRef from "./useMountedRef";

export default function useAsyncQueue() {
  const tail = useRef(Promise.resolve());
  const count = useRef(0);
  const mounted = useMountedRef();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    (action) => {
      if (typeof action !== "function")
        return Promise.reject(new TypeError(t("Операция очереди должна быть функцией")));
      count.current += 1;
      if (mounted.current) setPending(true);
      const result = tail.current.then(action);
      tail.current = result.catch(() => undefined);
      return result.finally(() => {
        count.current -= 1;
        if (mounted.current && count.current === 0) setPending(false);
      });
    },
    [mounted]
  );
  return { pending, run };
}
