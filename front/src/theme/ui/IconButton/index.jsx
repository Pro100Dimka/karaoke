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

    if (import.meta.env?.DEV && !accessibleLabel) {
      console.warn("[Light UI] IconButton needs aria-label, label or title.");
    }

    return (
      <Button
        ref={ref}
        size={size}
        className={cx("ui-icon-button", className)}
        aria-label={accessibleLabel}
        title={title ?? accessibleLabel}
        {...props}
      >
        {Icon ? (
          <Icon
            size={iconSize ?? ICON_SIZES[size] ?? ICON_SIZES.md}
            aria-hidden="true"
          />
        ) : (
          children
        )}
      </Button>
    );
  }
);

IconButton.displayName = "IconButton";

export default IconButton;
