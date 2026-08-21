import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./grid.css";

const unit = (value) => (typeof value === "number" ? `${value}px` : value);

export default function Grid({
  as = "div",
  columns,
  gap = 0,
  rowGap,
  columnGap,
  minItemWidth = "min(100%, 16rem)",
  collapseEmpty = true,
  align,
  justify,
  className,
  sx,
  style,
  ...props
}) {
  const adaptive = columns == null;

  return (
    <Primitive
      as={as}
      className={cx("ui-grid", className)}
      data-adaptive={adaptive || undefined}
      data-collapse-empty={adaptive && collapseEmpty ? "true" : "false"}
      sx={sx}
      style={{
        "--grid-columns": columns ?? 1,
        "--grid-gap": unit(gap),
        "--grid-row-gap": unit(rowGap ?? gap),
        "--grid-column-gap": unit(columnGap ?? gap),
        "--grid-min-item-width":
          typeof minItemWidth === "number" ? `${minItemWidth}px` : minItemWidth,
        "--grid-align": align ?? "stretch",
        "--grid-justify": justify ?? "stretch",
        ...style
      }}
      {...props}
    />
  );
}
