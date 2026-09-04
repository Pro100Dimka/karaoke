import { useCallback, useLayoutEffect, useReducer, useRef } from "react";

export default function useScroll(shellRef, surfaceRef) {
  const [, render] = useReducer((n) => n + 1, 0);
  const frame = useRef();
  const sync = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(render);
  }, []);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(sync);
    shell.addEventListener("scroll", sync, { passive: true });
    observer.observe(shell);
    if (surfaceRef.current) observer.observe(surfaceRef.current);
    return () => {
      cancelAnimationFrame(frame.current);
      shell.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [shellRef, surfaceRef, sync]);
  return sync;
}
