// MUI's default viewport breakpoints; keep grid.css media queries in sync.
export const GRID_BREAKPOINTS = { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 };

const isMap = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value > 0;

function responsiveVars(prefix, values, initial, format) {
  let previous = initial;
  return Object.fromEntries(
    Object.keys(GRID_BREAKPOINTS).map((point) => {
      const next = format(values?.[point]);
      if (next != null) previous = next;
      return [`${prefix}-${point}`, previous];
    })
  );
}

export function gridColumnStyles(columns, fallback) {
  const responsive = isMap(columns);
  const base =
    !responsive && (isCount(columns) || typeof columns === "string") ? columns : fallback;
  return {
    "--grid-columns": base,
    ...responsiveVars(
      "--grid-columns",
      responsive ? columns : null,
      "var(--grid-columns)",
      (value) => (isCount(value) ? value : undefined)
    )
  };
}

export function gridItemStyles(size, breakpoints) {
  // Explicit legacy breakpoint props override size at the same breakpoint.
  const sizes = isMap(size) ? { ...size } : { xs: size };
  Object.entries(breakpoints).forEach(([point, value]) => {
    if (value != null) sizes[point] = value;
  });
  const sized = Object.values(sizes).some(isCount);
  return {
    sized,
    style: responsiveVars("--grid-item-column", sizes, "auto", (value) =>
      isCount(value) ? `span ${value}` : undefined
    )
  };
}
