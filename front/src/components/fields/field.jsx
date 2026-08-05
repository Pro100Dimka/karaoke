export default function Field({
  id,
  label,
  hint,
  error,
  inline = false,
  className = "",
  children
}) {
  const classes = [inline ? "settings-toggle" : "settings-field", className]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={classes} htmlFor={id}>
      {(label || hint) && (
        <span>
          {label && <strong>{label}</strong>}
          {hint && <small>{hint}</small>}
        </span>
      )}
      {children}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function FieldRow({ className = "", children }) {
  return <div className={`field-row ${className}`.trim()}>{children}</div>;
}
