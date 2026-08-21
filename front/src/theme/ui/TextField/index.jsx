import { Info } from "lucide-react";
import { forwardRef, useId } from "react";
import IconButton from "../IconButton";
import InputBase from "../InputBase";
import OutlinedInput from "../OutlinedInput";
import Tooltip from "../Tooltip";
import cx from "../_internal/cx";
import "./text-field.css";

const TextField = forwardRef(({
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
  className,
  fieldClassName,
  sx,
  style,
  inputClassName,
  value,
  defaultValue,
  onChange,
  placeholder,
  rows,
  ...props
}, ref) => {
  const uid = useId().replace(/:/g, "");
  const controlId = id || `ui-text-field-${uid}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const hasFrame = Boolean(label || hint || error || start || end);
  const Control = multiline ? "textarea" : "input";

  const control = (
    <InputBase
      ref={ref}
      component={Control}
      id={controlId}
      className={cx(
        "ui-text-field-input ui-control ui-disabled ui-motion",
        inputClassName,
        !hasFrame && className
      )}
      size={size}
      tone={tone}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      value={value !== undefined ? value ?? "" : undefined}
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

  const labelNode = label && (
    <span className="ui-text-field-label-row">
      <label className="ui-text-field-label" htmlFor={controlId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {tooltip && (
        <Tooltip title={tooltip} placement="top">
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Подробнее"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Info size={14} />
          </IconButton>
        </Tooltip>
      )}
    </span>
  );

  return (
    <div
      className={cx("ui-field", fieldClassName)}
      data-disabled={disabled || undefined}
      data-error={!!error || undefined}
    >
      <OutlinedInput
        label={label}
        labelNode={labelNode}
        required={required}
        disabled={disabled}
        error={!!error}
        size={size}
        tone={tone}
        start={start}
        end={end}
        className={className}
        sx={sx}
        style={style}
      >
        {control}
      </OutlinedInput>

      {error ? (
        <small id={errorId} className="ui-field-message" data-error>{error}</small>
      ) : hint ? (
        <small id={hintId} className="ui-field-message">{hint}</small>
      ) : null}
    </div>
  );
});

export default TextField;
