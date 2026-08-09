import { forwardRef } from "react";
import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./button.css";

const Button = forwardRef(function Button({
  as = "button",
  type = "button",
  variant = "solid",
  tone = "primary",
  size = "md",
  disabled = false,
  className,
  onClick,
  tabIndex,
  ...props
}, ref) {
  const native = as === "button";

  const click = event => {
    if (!native && disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  return (
    <Primitive
      ref={ref}
      as={as}
      type={native ? type : undefined}
      className={cx("ui-button", "ui-control", "ui-focus-ring", "ui-disabled", "ui-motion", className)}
      data-variant={variant}
      data-tone={tone}
      data-size={size}
      disabled={native ? disabled : undefined}
      aria-disabled={!native && disabled ? true : undefined}
      tabIndex={!native && disabled ? -1 : tabIndex}
      onClick={click}
      {...props}
    />
  );
});

export default Button;
