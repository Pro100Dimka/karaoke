import { forwardRef } from "react";
import InputBase from "../InputBase";
import cx from "../_internal/cx";

const OutlinedInput = forwardRef((
  {
    label,
    labelAccessory = false,
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
) => {
  return (
    <InputBase
      ref={ref}
      component="div"
      disableNativeDisabled
      className={cx("ui-text-field", "ui-control", className)}
      disabled={disabled}
      error={error}
      size={size}
      tone={tone}
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
          <span>
            {label}{required ? " *" : ""}
            {labelAccessory && <i className="ui-text-field-legend-accessory" />}
          </span>
        </legend>
      </fieldset>
    </InputBase>
  );
});

OutlinedInput.displayName = "OutlinedInput";

export default OutlinedInput;
