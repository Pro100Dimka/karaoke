import { forwardRef, useEffect, useRef } from "react";
import mergeRefs from "../_internal/mergeRefs";
import "./checkbox.css";

const Checkbox = forwardRef(function Checkbox({
  checked,
  defaultChecked,
  indeterminate = false,
  disabled = false,
  size = "md",
  label,
  className = "",
  onChange,
  ...props
}, ref) {
  const localRef = useRef(null);

  useEffect(() => {
    if (localRef.current) localRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const controlled = checked !== undefined;

  const input = (
    <input
      ref={mergeRefs(ref, localRef)}
      type="checkbox"
      className={`ui-checkbox ui-focus-ring ui-disabled ui-motion ${className}`.trim()}
      data-size={size}
      checked={controlled ? checked : undefined}
      defaultChecked={controlled ? undefined : defaultChecked}
      disabled={disabled}
      aria-checked={indeterminate ? "mixed" : undefined}
      onChange={event => onChange?.(event.target.checked, event)}
      {...props}
    />
  );

  return label ? (
    <label className="ui-checkbox-label" data-disabled={disabled || undefined}>
      {input}
      <span>{label}</span>
    </label>
  ) : input;
});

export default Checkbox;
