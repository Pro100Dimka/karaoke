import { forwardRef } from "react";
import cx from "../_internal/cx";
import mergeSx from "../_internal/sx";
import "./switch.css";

const Switch = forwardRef(function Switch({
  checked,
  defaultChecked,
  disabled = false,
  size = "md",
  label,
  className,
  sx,
  style,
  onChange,
  ...props
}, ref) {
  const controlled = checked !== undefined;

  const input = (
    <input
      ref={ref}
      type="checkbox"
      role="switch"
      className={cx("ui-switch", "ui-focus-ring", "ui-disabled", "ui-motion", className)}
      data-size={size}
      checked={controlled ? checked : undefined}
      defaultChecked={controlled ? undefined : defaultChecked}
      disabled={disabled}
      onChange={event => onChange?.(event.target.checked, event)}
      style={mergeSx(sx, style)}
      {...props}
    />
  );

  return label ? (
    <label className="ui-switch-label" data-disabled={disabled || undefined}>
      {input}
      <span>{label}</span>
    </label>
  ) : input;
});

export default Switch;
