import { forwardRef } from "react";
import cx from "../_internal/cx";
import mergeSx from "../_internal/sx";

const InputBase = forwardRef(function InputBase(
  {
    component: Component = "input",
    className,
    sx,
    style,
    disabled,
    error,
    size,
    tone,
    disableNativeDisabled = false,
    ...props
  },
  ref
) {
  return (
    <Component
      ref={ref}
      className={cx(className)}
      style={mergeSx(sx, style)}
      {...(size !== undefined && { "data-size": size })}
      {...(tone !== undefined && { "data-tone": tone })}
      {...(disabled && { "data-disabled": true })}
      {...(error && { "data-error": true })}
      {...(!disableNativeDisabled && { disabled })}
      {...props}
    />
  );
});

export default InputBase;
