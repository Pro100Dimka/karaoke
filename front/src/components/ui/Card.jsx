export default function Card({
  as: Component = "div",
  className = "",
  variant = "glass",
  children,
  onPointerMove,
  onPointerLeave,
  ...props
}) {
  const isNeon = variant === "neon";

  const handlePointerMove = (event) => {
    if (isNeon) {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;

      event.currentTarget.style.setProperty("--card-mx", `${x}%`);
      event.currentTarget.style.setProperty("--card-my", `${y}%`);
    }

    onPointerMove?.(event);
  };

  const handlePointerLeave = (event) => {
    if (isNeon) {
      event.currentTarget.style.removeProperty("--card-mx");
      event.currentTarget.style.removeProperty("--card-my");
    }

    onPointerLeave?.(event);
  };

  return (
    <Component
      className={`ui-card ui-card--${variant} ${className}`.trim()}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      {...props}
    >
      {isNeon && (
        <>
          <span className="ui-card__fx ui-card__glow" aria-hidden="true" />
          <span className="ui-card__fx ui-card__glow-mid" aria-hidden="true" />
          <span className="ui-card__fx ui-card__edge" aria-hidden="true" />
          <span className="ui-card__fx ui-card__glint" aria-hidden="true" />
          <span className="ui-card__fx ui-card__sheen" aria-hidden="true" />
        </>
      )}
      {children}
    </Component>
  );
}
