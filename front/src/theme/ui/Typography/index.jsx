import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./typography.css";

const TAGS = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
  body1: "p",
  body2: "p",
  caption: "span"
};

export default function Typography({
  as,
  variant = "body1",
  tone = "primary",
  align,
  noWrap = false,
  className,
  style,
  ...props
}) {
  return (
    <Primitive
      as={as || TAGS[variant] || "span"}
      className={cx("ui-typography", className)}
      data-variant={variant}
      data-tone={tone}
      data-nowrap={noWrap || undefined}
      style={{ "--typography-align": align, ...style }}
      {...props}
    />
  );
}
