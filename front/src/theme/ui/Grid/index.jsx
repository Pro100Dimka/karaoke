import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import { gridColumnStyles, gridItemStyles } from "./responsive";
import "./grid.css";

const unit = (value) => (typeof value === "number" ? `${value}px` : value);

export default function Grid({
  as = "div",
  columns,
  container = false,
  item = false,
  size,
  xs,
  sm,
  md,
  lg,
  xl,
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
  const sizing = gridItemStyles(size, { xs, sm, md, lg, xl });
  const isItem = item || sizing.sized;
  // Existing Grid usage remains an adaptive/fixed CSS-grid container. New
  // MUI-style sized items are plain items unless also declared containers.
  const isContainer = container || columns != null || !isItem;
  const adaptive = isContainer && !container && columns == null;

  return (
    <Primitive
      as={as}
      className={cx("ui-grid", className)}
      data-grid-item={isItem || undefined}
      data-grid-container={isContainer || undefined}
      data-adaptive={adaptive || undefined}
      data-collapse-empty={adaptive && collapseEmpty ? "true" : "false"}
      sx={sx}
      style={{
        ...gridColumnStyles(columns, container ? 12 : 1),
        ...sizing.style,
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
