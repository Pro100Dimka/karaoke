import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./stack.css";

const unit = (value) => (typeof value === "number" ? `${value}px` : value);

export default function Stack({
  as = "div",
  direction = "column",
  gap = 0,
  align,
  justify,
  wrap = false,
  className,
  style,
  ...props
}) {
  return (
    <Primitive
      as={as}
      className={cx("ui-stack", className)}
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
