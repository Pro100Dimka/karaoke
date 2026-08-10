import { useId } from "react";
import cx from "../cx";
import FieldLabel from "../FieldLabel";
import mergeSx from "../sx";
import "./field.css";

export default function Field({
  id,
  label,
  tooltip,
  hint,
  error,
  required = false,
  disabled = false,
  className,
  sx,
  style,
  children
}) {
  const uid = useId().replace(/:/g, "");

  const controlId = id || `ui-field-${uid}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  const control = children({
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined
  });

  if (!label && !hint && !error) {
    return control;
  }

  return (
    <div
      className={cx("ui-field", className)}
      data-disabled={disabled || undefined}
      data-error={!!error || undefined}
      style={mergeSx(sx, style)}
    >
      <FieldLabel
        htmlFor={controlId}
        label={label}
        tooltip={tooltip}
        required={required}
      />

      {control}

      {error ? (
        <small id={errorId} className="ui-field-message" data-error>
          {error}
        </small>
      ) : hint ? (
        <small id={hintId} className="ui-field-message">
          {hint}
        </small>
      ) : null}
    </div>
  );
}
