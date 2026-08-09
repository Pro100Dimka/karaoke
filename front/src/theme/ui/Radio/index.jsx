import { forwardRef } from "react";
import "./radio.css";

const Radio = forwardRef(function Radio({
  label,
  size = "md",
  className = "",
  onChange,
  ...props
}, ref) {
  const input = (
    <input
      ref={ref}
      type="radio"
      className={`ui-radio ui-focus-ring ui-disabled ui-motion ${className}`.trim()}
      data-size={size}
      onChange={event => onChange?.(event.target.value, event)}
      {...props}
    />
  );

  return label ? <label className="ui-radio-label">{input}<span>{label}</span></label> : input;
});

export default Radio;
