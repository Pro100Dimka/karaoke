import cx from "../../utils/cx";

export default function Field({
  id,
  label,
  hint,
  error,
  inline = false,
  className = "",
  variant,
  children
}) {
  const baseClass = inline ? "settings-toggle" : "settings-field";
  const classes = cx(baseClass, variant && `${baseClass}--${variant}`, className);

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
