import { forwardRef } from "react";
import Field from "../_internal/Field";
import cx from "../_internal/cx";
import "./text-field.css";

const TextField = forwardRef(function TextField({
  id,
  label,
  hint,
  error,
  required = false,
  disabled = false,
  readOnly = false,
  size = "md",
  tone = "default",
  start,
  end,
  className,
  fieldClassName,
  inputClassName,
  value,
  defaultValue,
  onChange,
  ...props
}, ref) {
  const control = fieldProps => {
    const input = (
      <input
        ref={ref}
        className={cx(
          "ui-text-field-input ui-control ui-focus-shadow ui-disabled ui-motion",
          inputClassName,
          !start && !end && className
        )}
        data-size={size}
        data-tone={tone}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        value={value !== undefined ? value ?? "" : undefined}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={event => onChange?.(event.target.value, event)}
        {...fieldProps}
        {...props}
      />
    );

    if (!start && !end) return input;

    return (
      <span
        className={cx("ui-text-field ui-control ui-motion", className)}
        data-size={size}
        data-disabled={disabled || undefined}
        data-error={!!error || undefined}
      >
        {start && <span className="ui-text-field-slot">{start}</span>}
        {input}
        {end && <span className="ui-text-field-slot">{end}</span>}
      </span>
    );
  };

  return label || hint || error ? (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      className={fieldClassName}
    >
      {control}
    </Field>
  ) : control({ id });
});

export default TextField;
