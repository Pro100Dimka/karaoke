import "./badge.css";

const anchorClass = ({ vertical = "top", horizontal = "right" } = {}) =>
  `${vertical}-${horizontal}`;

export default function Badge({
  badgeContent,
  children,
  tone = "danger",
  variant = "standard",
  size = "md",
  max = 99,
  showZero = false,
  invisible = false,
  overlap = "rectangular",
  anchorOrigin,
  className = "",
  badgeClassName = "",
  ...props
}) {
  const numeric = typeof badgeContent === "number";
  const hidden = invisible || (variant !== "dot" && !showZero && numeric && badgeContent === 0);
  const content = numeric && badgeContent > max ? `${max}+` : badgeContent;

  return (
    <span className={`ui-badge ${className}`.trim()} data-overlap={overlap} {...props}>
      {children}
      <span
        className={`ui-badge__badge ${badgeClassName}`.trim()}
        data-anchor={anchorClass(anchorOrigin)}
        data-tone={tone}
        data-variant={variant}
        data-size={size}
        data-invisible={hidden || undefined}
        aria-hidden={hidden || undefined}
      >
        {variant === "dot" ? null : content}
      </span>
    </span>
  );
}
