import mergeSx from "../_internal/sx";
import "./badge.css";

export default function Badge({
  content,
  tone = "primary",
  invisible,
  children,
  className = "",
  sx,
  style
}) {
  return (
    <span className={`ui-badge ${className}`.trim()} style={mergeSx(sx, style)}>
      {children}
      {!invisible && <span className="ui-badge-content" data-tone={tone}>{content}</span>}
    </span>
  );
}
