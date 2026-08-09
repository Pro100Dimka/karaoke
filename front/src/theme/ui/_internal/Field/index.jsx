import { useId } from "react";
import cx from "../cx";
import "./field.css";

export default function Field({
  id,
  label,
  hint,
  error,
  required = false,
  disabled = false,
  className,
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

  if (!label && !hint && !error) return control;

  return (
    <div
      className={cx("ui-field", className)}
      data-disabled={disabled || undefined}
      data-error={!!error || undefined}
    >
      {label && (
        <label className="ui-field-label" htmlFor={controlId}>
          {label}
          {required && <span className="ui-field-required" aria-hidden="true"> *</span>}
        </label>
      )}

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
