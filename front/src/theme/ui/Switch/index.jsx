import { forwardRef, useId } from "react";
import OutlinedInput from "../OutlinedInput";
import FloatingLabel from "../_internal/FloatingLabel";
import cx from "../_internal/cx";
import mergeSx from "../_internal/sx";
import useControllable from "../_internal/useControllable";
import "./switch.css";

const Switch = forwardRef(({
  id,
  checked,
  defaultChecked,
  disabled = false,
  required = false,
  size = "md",
  variant,
  label,
  tooltip,
  hint,
  error,
  checkedText,
  uncheckedText,
  className,
  fieldClassName,
  sx,
  style,
  onChange,
  ...props
}, ref) => {
  const uid = useId().replace(/:/g, "");
  const controlId = id || `ui-switch-${uid}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const [current, setCurrent] = useControllable(checked, defaultChecked ?? false, onChange);
  const input = (
    <input
      ref={ref}
      id={controlId}
      type="checkbox"
      role="switch"
      className={cx("ui-switch", "ui-control", "ui-focus-ring", "ui-disabled", "ui-motion", className)}
      data-size={size}
      checked={Boolean(current)}
      disabled={disabled}
      required={required}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      onChange={(event) => setCurrent(event.target.checked, event)}
      style={mergeSx(sx, style)}
      {...props}
    />
  );

  if (!label) return input;
  if (variant === "plain") {
    return (
      <label
        className="ui-switch-label ui-control"
        data-size={size}
        data-disabled={disabled || undefined}
      >
        {input}
        <span>{label}</span>
      </label>
    );
  }

  const status = current ? checkedText : uncheckedText;
  return (
    <div
      className={cx("ui-field", "ui-switch-field-wrap", fieldClassName)}
      data-disabled={disabled || undefined}
      data-error={!!error || undefined}
    >
      <OutlinedInput
        label={label}
        labelAccessory={Boolean(tooltip)}
        labelNode={
          <FloatingLabel id={controlId} label={label} required={required} tooltip={tooltip} />
        }
        required={required}
        disabled={disabled}
        error={!!error}
        size={size}
        className="ui-switch-field"
        data-filled
      >
        <span className="ui-switch-control">
          {status && <span className="ui-switch-status">{status}</span>}
          {input}
        </span>
      </OutlinedInput>
      {error ? (
        <small id={errorId} className="ui-field-message" data-error>{error}</small>
      ) : hint ? (
        <small id={hintId} className="ui-field-message">{hint}</small>
      ) : null}
    </div>
  );
});

Switch.displayName = "Switch";

export default Switch;
