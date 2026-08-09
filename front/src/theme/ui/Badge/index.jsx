import "./badge.css";

export default function Badge({
  content,
  tone = "primary",
  invisible,
  children,
  className = ""
}) {
  return (
    <span className={`ui-badge ${className}`.trim()}>
      {children}
      {!invisible && <span className="ui-badge-content" data-tone={tone}>{content}</span>}
    </span>
  );
}
