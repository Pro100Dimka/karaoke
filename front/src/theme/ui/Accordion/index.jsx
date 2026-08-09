import "./accordion.css";

export default function Accordion({
  summary,
  children,
  open,
  defaultOpen,
  onToggle,
  className = ""
}) {
  const controlled = open !== undefined;

  return (
    <details
      className={`ui-accordion ${className}`.trim()}
      open={controlled ? open : undefined}
      {...(!controlled && defaultOpen ? { open: true } : {})}
      onToggle={(event) => onToggle?.(event.currentTarget.open, event)}
    >
      <summary>{summary}</summary>
      <div className="ui-accordion-content">{children}</div>
    </details>
  );
}
