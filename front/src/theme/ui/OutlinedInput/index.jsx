import { forwardRef } from "react";
import InputBase from "../InputBase";
import cx from "../_internal/cx";

const OutlinedInput = forwardRef(function OutlinedInput(
  {
    label,
    required = false,
    disabled = false,
    error = false,
    size = "md",
    tone = "default",
    start,
    end,
    labelNode,
    className,
    sx,
    style,
    children,
    ...props
  },
  ref
) {
  return (
    <InputBase
      ref={ref}
      component="div"
      disableNativeDisabled
      className={cx("ui-text-field", className)}
      disabled={disabled}
      error={error}
      size={size}
      sx={sx}
      style={style}
      {...props}
    >
      {labelNode}
      {start && <span className="ui-text-field-slot">{start}</span>}
      {children}
      {end && <span className="ui-text-field-slot">{end}</span>}
      <fieldset className="ui-text-field-outline" aria-hidden="true">
        <legend>
          <span>{label}{required ? " *" : ""}</span>
        </legend>
      </fieldset>
    </InputBase>
  );
});

export default OutlinedInput;
