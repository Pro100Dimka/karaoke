import "./divider.css";

export default function Divider({ vertical, className = "", ...props }) {
  return (
    <hr
      className={`ui-divider ${className}`.trim()}
      data-vertical={vertical || undefined}
      {...props}
    />
  );
}
