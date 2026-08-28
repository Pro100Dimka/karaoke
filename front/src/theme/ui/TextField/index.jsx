import { forwardRef, useId } from "react";
import InputBase from "../InputBase";
import OutlinedInput from "../OutlinedInput";
import FloatingLabel from "../_internal/FloatingLabel";
import cx from "../_internal/cx";
import "./text-field.css";

const TextField = forwardRef(
  (
    {
      id,
      label,
      hint,
      tooltip,
      error,
      required = false,
      disabled = false,
      readOnly = false,
      multiline = false,
      type = "text",
      size = "md",
      tone = "default",
      start,
      end,
      startAdornment,
      endAdornment,
      className,
      fieldClassName,
      sx,
      style,
      inputClassName,
      fullWidth = false,
      value,
      defaultValue,
      onChange,
      placeholder,
      rows,
      ...props
    },
    ref
  ) => {
    const uid = useId().replace(/:/g, "");
    const controlId = id || `ui-text-field-${uid}`;
    const hintId = hint ? `${controlId}-hint` : undefined;
    const errorId = error ? `${controlId}-error` : undefined;
    const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
    const startSlot = startAdornment ?? start;
    const endSlot = endAdornment ?? end;
    const hasFrame = Boolean(label || hint || error || startSlot || endSlot);
    const Control = multiline ? "textarea" : "input";

    const control = (
      <InputBase
        ref={ref}
        component={Control}
        id={controlId}
        className={cx(
          "ui-text-field-input ui-control ui-disabled ui-motion",
          fullWidth && "ui-text-field-full-width",
          inputClassName,
          !hasFrame && className
        )}
        size={size}
        tone={tone}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        value={value !== undefined ? (value ?? "") : undefined}
        defaultValue={value === undefined ? defaultValue : undefined}
        onChange={(event) => onChange?.(event.target.value, event)}
        placeholder={placeholder ?? (label ? " " : undefined)}
        rows={multiline ? rows : undefined}
        type={multiline ? undefined : type}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        sx={!hasFrame ? sx : undefined}
        style={!hasFrame ? style : undefined}
        {...props}
      />
    );

    if (!hasFrame) return control;

    const framedControl = (
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
        tone={tone}
        start={startSlot}
        end={endSlot}
        className={cx(
          className,
          fullWidth && "ui-text-field-full-width",
          !label && "ui-text-field-no-label"
        )}
        sx={sx}
        style={style}
      >
        {control}
      </OutlinedInput>
    );

    if (!label && !hint && !error) return framedControl;

    return (
      <div
        className={cx("ui-field", fullWidth && "ui-field-full-width", fieldClassName)}
        data-disabled={disabled || undefined}
        data-error={!!error || undefined}
      >
        {framedControl}

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
);

export default TextField;
