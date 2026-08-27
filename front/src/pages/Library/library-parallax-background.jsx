import { useEffect, useRef } from "react";
import { Box } from "../../theme/ui";

const MAX_X = 18;
const MAX_Y = 12;
const EASING = 0.085;

export default function LibraryParallaxBackground() {
  const layerRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!layer || reducedMotion) return undefined;

    let frame = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;

    const draw = () => {
      currentX += (targetX - currentX) * EASING;
      currentY += (targetY - currentY) * EASING;
      layer.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0) scale(1.055)`;
      if (Math.abs(targetX - currentX) > 0.02 || Math.abs(targetY - currentY) > 0.02) {
        frame = requestAnimationFrame(draw);
      } else {
        frame = 0;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const move = (event) => {
      targetX = -((event.clientX / Math.max(1, window.innerWidth)) * 2 - 1) * MAX_X;
      targetY = -((event.clientY / Math.max(1, window.innerHeight)) * 2 - 1) * MAX_Y;
      schedule();
    };
    const center = () => {
      targetX = 0;
      targetY = 0;
      schedule();
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("blur", center);
    document.documentElement.addEventListener("mouseleave", center);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("blur", center);
      document.documentElement.removeEventListener("mouseleave", center);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <Box
      ref={layerRef}
      aria-hidden="true"
      sx={{
        position: "fixed",
        inset: "-4vh -4vw",
        zIndex: 0,
        pointerEvents: "none",
        background: "var(--bg-image) center / cover no-repeat",
        transform: "translate3d(0, 0, 0) scale(1.055)",
        transformOrigin: "center",
        willChange: "transform"
      }}
    />
  );
}
