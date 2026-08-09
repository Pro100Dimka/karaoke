import "./avatar.css";

export default function Avatar({
  src,
  alt = "",
  name = "",
  size = "md",
  className = "",
  ...props
}) {
  const common = {
    className: `ui-avatar ${className}`.trim(),
    "data-size": size,
    ...props
  };

  if (src)
    return <img src={src} alt={alt || name} {...common} />;

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toUpperCase();

  return (
    <span aria-label={alt || name || undefined} {...common}>
      {initials || "?"}
    </span>
  );
}
