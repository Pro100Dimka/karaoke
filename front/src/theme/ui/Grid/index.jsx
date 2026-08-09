import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./grid.css";

export default function Grid({
  as = "div",
  columns,
  gap = 0,
  rowGap,
  columnGap,
  minItemWidth = "min(100%, 16rem)",
  align,
  justify,
  className,
  style,
  ...props
}) {
  const adaptive = columns == null;

  return (
    <Primitive
      as={as}
      className={cx("ui-grid", className)}
      data-adaptive={adaptive || undefined}
      style={{
        "--grid-columns": columns ?? 1,
        "--grid-gap": gap,
        "--grid-row-gap": rowGap,
        "--grid-column-gap": columnGap,
        "--grid-min-item-width":
          typeof minItemWidth === "number" ? `${minItemWidth}rem` : minItemWidth,
        "--grid-align": align,
        "--grid-justify": justify,
        ...style
      }}
      {...props}
    />
  );
}
