import { forwardRef } from "react";

import Button from "../Button";
import cx from "../_internal/cx";

import "./icon-button.css";

const ICON_SIZES = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24
};

const IconButton = forwardRef(
  (
    {
      icon: Icon,
      size = "md",
      iconSize,
      unstyled = false,
      className,
      children,
      "aria-label": ariaLabel,
      label,
      title,
      ...props
    },
    ref
  ) => {
    const accessibleLabel = ariaLabel ?? label ?? title;
    const buttonSize = iconSize ?? ICON_SIZES[size] * 2;
    const actualIconSize = buttonSize * 0.45;

    return (
      <Button
        ref={ref}
        size={size}
        unstyled={unstyled}
        className={unstyled ? className : cx("ui-icon-button", className)}
        aria-label={accessibleLabel}
        title={title ?? accessibleLabel}
        style={{ "--control-size": `${buttonSize}px` }}
        {...props}
      >
        {Icon ? <Icon size={actualIconSize} aria-hidden="true" /> : children}
      </Button>
    );
  }
);

IconButton.displayName = "IconButton";

export default IconButton;
