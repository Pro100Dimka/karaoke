import mergeSx from "../_internal/sx";
import "./spinner.css";

export default function Spinner({ size = "md", className = "", sx, style, ...props }) {
  return (
    <span
      className={`ui-spinner ${className}`.trim()}
      data-size={size}
      role="status"
      aria-label="Загрузка"
      style={mergeSx(sx, style)}
      {...props}
    />
  );
}
