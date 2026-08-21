import Stack from "../../theme/ui/Stack";
import cx from "../../utils/cx";

export default function Field({
  id,
  label,
  hint,
  error,
  inline = false,
  floating = false,
  className = "",
  variant,
  children
}) {
  const baseClass = inline ? "settings-toggle" : "settings-field";
  const classes = cx(
    baseClass,
    floating && `${baseClass}--floating`,
    variant && `${baseClass}--${variant}`,
    className
  );

  return (
    <Stack gap={0.5} align="start">
      <label className={classes} htmlFor={id}>
        {(label || (!floating && hint)) && (
          <span>
            {label && <strong>{label}</strong>}
            {!floating && hint && <small>{hint}</small>}
          </span>
        )}
      </label>
      {children}
      {floating && hint && (
        <small id={`${id}-hint`} className="field-hint">
          {hint}
        </small>
      )}
      {error && <small className="field-error">{error}</small>}
    </Stack>
  );
}

export function FieldRow({ className = "", children }) {
  return <div className={`field-row ${className}`.trim()}>{children}</div>;
}
