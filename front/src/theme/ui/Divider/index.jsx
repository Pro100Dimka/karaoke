import mergeSx from "../_internal/sx";
import "./divider.css";

export default function Divider({ vertical, className = "", sx, style, ...props }) {
  return (
    <hr
      className={`ui-divider ${className}`.trim()}
      data-vertical={vertical || undefined}
      style={mergeSx(sx, style)}
      {...props}
    />
  );
}
