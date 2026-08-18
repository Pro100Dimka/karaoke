// Shared pointer-driven neon tilt/glow handler used by both card
// implementations (components/ui/Card and theme/ui/Card). Only the CSS
// custom-property side effects live here; each Card keeps its own markup,
// classNames and prop contract untouched.
export default function useCardTilt({
  isNeon,
  tilt,
  extraPositionVars = [],
  onPointerMove,
  onPointerLeave
}) {
  const handlePointerMove = (event) => {
    if (isNeon) {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      const { style } = event.currentTarget;

      style.setProperty("--card-mx", `${x}%`);
      style.setProperty("--card-my", `${y}%`);
      extraPositionVars.forEach(([xName, yName]) => {
        style.setProperty(xName, `${x}%`);
        style.setProperty(yName, `${y}%`);
      });

      if (tilt) {
        style.setProperty("--tilt-x", `${(0.5 - y / 100) * 8}deg`);
        style.setProperty("--tilt-y", `${(x / 100 - 0.5) * 10}deg`);
      }
    }

    onPointerMove?.(event);
  };

  const handlePointerLeave = (event) => {
    if (isNeon) {
      const names = ["--card-mx", "--card-my", ...extraPositionVars.flat()];
      if (tilt) names.push("--tilt-x", "--tilt-y");
      names.forEach((name) => event.currentTarget.style.removeProperty(name));
    }

    onPointerLeave?.(event);
  };

  return { handlePointerMove, handlePointerLeave };
}
