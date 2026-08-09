import mergeSx from "../_internal/sx";
import "./accordion.css";

export default function Accordion({
  summary,
  children,
  open,
  defaultOpen,
  onToggle,
  className = "",
  sx,
  style
}) {
  const controlled = open !== undefined;

  return (
    <details
      className={`ui-accordion ${className}`.trim()}
      style={mergeSx(sx, style)}
      open={controlled ? open : undefined}
      {...(!controlled && defaultOpen ? { open: true } : {})}
      onToggle={event => onToggle?.(event.currentTarget.open, event)}
    >
      <summary>{summary}</summary>
      <div className="ui-accordion-content">{children}</div>
    </details>
  );
}
