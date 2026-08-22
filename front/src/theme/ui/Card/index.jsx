import { forwardRef } from "react";

import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./card.css";
import useCardTilt from "./useCardTilt";

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
      overlay,
      className,
      sx,
      disablePadding,
      style,
      children,
      onPointerMove,
      onPointerLeave,
      ...props
    },
    ref
  ) => {
    const isNeon = ["neon", "animation", "aurora", "laser"].includes(variant);
    const { handlePointerMove, handlePointerLeave } = useCardTilt({
      isNeon,
      tilt,
      extraPositionVars: [["--glow-x", "--glow-y"]],
      onPointerMove,
      onPointerLeave
    });

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
          ...style,
          ...disablePadding && { padding: 0 },
        }}
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
            {overlay}
          </>
        ) : (
          <>
            {children}
            {overlay}
          </>
        )}
      </Primitive>
    );
  }
);

export default Card;
