import { forwardRef } from "react";

const Card = forwardRef(
  (
    {
      as: Component = "div",
      className = "",
      variant = "glass",
      children,
      onPointerMove,
      onPointerLeave,
      tilt = true,
      cardContent,
      cardPanel,
      ...props
    },
    ref
  ) => {
    const isNeon = variant === "neon";

    const handlePointerMove = (event) => {
      if (isNeon) {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 100;
        const y = ((event.clientY - rect.top) / rect.height) * 100;

        event.currentTarget.style.setProperty("--card-mx", `${x}%`);
        event.currentTarget.style.setProperty("--card-my", `${y}%`);

        if (tilt) {
          const tiltX = (0.5 - y / 100) * 8;
          const tiltY = (x / 100 - 0.5) * 10;
          event.currentTarget.style.setProperty("--tilt-x", `${tiltX}deg`);
          event.currentTarget.style.setProperty("--tilt-y", `${tiltY}deg`);
        }
      }

      onPointerMove?.(event);
    };

    const handlePointerLeave = (event) => {
      if (isNeon) {
        event.currentTarget.style.removeProperty("--card-mx");
        event.currentTarget.style.removeProperty("--card-my");
        if (tilt) {
          event.currentTarget.style.removeProperty("--tilt-x");
          event.currentTarget.style.removeProperty("--tilt-y");
        }
      }

      onPointerLeave?.(event);
    };

    return (
      <Component
        ref={ref}
        className={`ui-card ui-card--${variant} ${!tilt ? "ui-card--no-tilt" : ""} ${className}`.trim()}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        {...props}
      >
        {isNeon ? (
          <>
            <span className="ui-card__fx ui-card__glow" aria-hidden="true" />
            <span
              className="ui-card__fx ui-card__glow-mid"
              aria-hidden="true"
            />
            <span className="ui-card__fx ui-card__edge" aria-hidden="true" />
            <span className="ui-card__fx ui-card__glint" aria-hidden="true" />
            <div
              {...cardPanel}
              className={`ui-card__panel ${cardPanel?.className || ""}`}
            >
              <span className="ui-card__fx ui-card__sheen" aria-hidden="true" />
              <div
                {...cardContent}
                className={`ui-card__content ${cardContent?.className || ""}`}
              >
                {children}
              </div>
            </div>
          </>
        ) : (
          children
        )}
      </Component>
    );
  }
);

export default Card;
