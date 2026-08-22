import { forwardRef } from "react";
import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./stack.css";

const unit = (value) => (typeof value === "number" ? `${value}rem` : value);

const Stack = forwardRef(function Stack({
  as = "div",
  direction = "column",
  gap = 0,
  align,
  justify,
  wrap = false,
  className,
  sx,
  style,
  ...props
}, ref) {
  return (
    <Primitive
      ref={ref}
      as={as}
      className={cx("ui-stack", className)}
      sx={sx}
      style={{
        "--stack-direction": direction,
        "--stack-gap": unit(gap),
        "--stack-align": align ?? "stretch",
        "--stack-justify": justify ?? "flex-start",
        "--stack-wrap": wrap ? "wrap" : "nowrap",
        ...style
      }}
      {...props}
    />
  );
});

export default Stack;
