import "./spinner.css";

export default function Spinner({ size = "md", className = "", ...props }) {
  return (
    <span
      className={`ui-spinner ${className}`.trim()}
      data-size={size}
      role="status"
      aria-label="Загрузка"
      {...props}
    />
  );
}
