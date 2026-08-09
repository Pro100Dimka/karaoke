import Primitive from "../_internal/Primitive";
import "./skeleton.css";

export default function Skeleton({
  as = "span",
  width,
  height,
  radius = "md",
  className = "",
  style,
  ...props
}) {
  return (
    <Primitive
      as={as}
      className={`ui-skeleton ${className}`.trim()}
      style={{
        "--skeleton-width": typeof width === "number" ? `${width}px` : width,
        "--skeleton-height": typeof height === "number" ? `${height}px` : height,
        "--skeleton-radius": `var(--shape-${radius})`,
        ...style
      }}
      aria-hidden="true"
      {...props}
    />
  );
}
