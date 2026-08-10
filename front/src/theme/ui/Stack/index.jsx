import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./stack.css";

const unit = (value) => (typeof value === "number" ? `${value}rem` : value);

export default function Stack({
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
}) {
  return (
    <Primitive
      as={as}
      className={cx("ui-stack", className)}
      sx={sx}
      style={{
        "--stack-direction": direction,
        "--stack-gap": unit(gap),
        "--stack-align": align,
        "--stack-justify": justify,
        "--stack-wrap": wrap ? "wrap" : "nowrap",
        ...style
      }}
      {...props}
    />
  );
}
