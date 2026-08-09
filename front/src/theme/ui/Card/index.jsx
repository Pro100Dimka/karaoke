import { forwardRef } from "react";

import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./card.css";

const Card = forwardRef(
  (
    {
      as = "section",
      surface = "base",
      variant,
      elevation = 0,
      interactive = false,
      loading = false,
      tilt = true,
      cardContent,
      cardPanel,
      className,
      sx,
      style,
      children,
      onPointerMove,
      onPointerLeave,
      ...props
    },
    ref
  ) => {
    const isNeon = variant === "neon" || variant === "animation";

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

    const content = isNeon ? (
      <>
        <span className="ui-card__fx ui-card__glow" aria-hidden="true" />
        <span className="ui-card__fx ui-card__glow-mid" aria-hidden="true" />
        <span className="ui-card__fx ui-card__edge" aria-hidden="true" />
        <span className="ui-card__fx ui-card__glint" aria-hidden="true" />

        <div
          {...cardPanel}
          className={cx("ui-card__panel", cardPanel?.className)}
        >
          <span className="ui-card__fx ui-card__sheen" aria-hidden="true" />

          <div
            {...cardContent}
            className={cx("ui-card__content", cardContent?.className)}
          >
            {children}
          </div>
        </div>
      </>
    ) : (
      children
    );

    return (
      <Primitive
        ref={ref}
        as={as}
        className={cx(
          "ui-card",
          isNeon && "ui-card--neon",
          !tilt && "ui-card--no-tilt",
          className
        )}
        data-surface={surface}
        data-variant={variant || undefined}
        data-interactive={interactive || undefined}
        data-loading={loading || undefined}
        sx={sx}
        style={{
          "--card-shadow": `var(--shadows-${elevation})`,
          ...style
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        {...props}
      >
        {content}
      </Primitive>
    );
  }
);

export default Card;
