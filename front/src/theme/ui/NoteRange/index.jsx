import { forwardRef } from "react";

import Field from "../_internal/Field";
import cx from "../_internal/cx";
import mergeSx from "../_internal/sx";
import useControllable from "../_internal/useControllable";
import TextField from "../TextField";

import "./note-range.css";

const normalize = (value) => {
  if (Array.isArray(value)) {
    return {
      min: value[0] ?? null,
      max: value[1] ?? null
    };
  }

  return {
    min: value?.min ?? null,
    max: value?.max ?? null
  };
};

const numberOrNull = (value) =>
  value === "" || value == null ? null : Number(value);

const NoteRange = forwardRef(function NoteRange(
  {
    id,
    label,
    tooltip,
    hint,
    error,
    required = false,
    disabled = false,

    value,
    defaultValue,
    onChange,

    min = 0,
    max = 127,
    step = 1,

    minPlaceholder = "Мин.",
    maxPlaceholder = "Макс.",

    className,
    fieldClassName,
    sx,
    style,
    fieldSx,
    fieldStyle,

    minProps = {},
    maxProps = {}
  },
  ref
) {
  const [current, setCurrent] = useControllable(
    value === undefined ? undefined : normalize(value),
    normalize(defaultValue),
    onChange
  );

  const range = normalize(current);

  const update = (key, rawValue, event) => {
    const next = {
      ...range,
      [key]: numberOrNull(rawValue)
    };

    setCurrent(next, event);
  };

  const control = (fieldProps = {}) => {
    const {
      id: controlId,
      ...ariaProps
    } = fieldProps;

    return (
      <div
        className={cx("ui-note-range", className)}
        data-disabled={disabled || undefined}
        data-error={!!error || undefined}
        style={mergeSx(sx, style)}
      >
        <TextField
          ref={ref}
          id={controlId}
          type="number"
          value={range.min ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder={minPlaceholder}
          disabled={disabled}
          required={required}
          aria-label={`${label || "Диапазон"}: минимум`}
          onChange={(nextValue, event) => update("min", nextValue, event)}
          {...ariaProps}
          {...minProps}
        />

        <span className="ui-note-range-separator" aria-hidden="true">
          —
        </span>

        <TextField
          id={`${controlId}-max`}
          type="number"
          value={range.max ?? ""}
          min={min}
          max={max}
          step={step}
          placeholder={maxPlaceholder}
          disabled={disabled}
          required={required}
          aria-label={`${label || "Диапазон"}: максимум`}
          onChange={(nextValue, event) => update("max", nextValue, event)}
          {...ariaProps}
          {...maxProps}
        />
      </div>
    );
  };

  return label || hint || error ? (
    <Field
      id={id}
      label={label}
      tooltip={tooltip}
      hint={hint}
      error={error}
      required={required}
      disabled={disabled}
      className={fieldClassName}
      sx={fieldSx}
      style={fieldStyle}
    >
      {control}
    </Field>
  ) : (
    control({ id })
  );
});

export default NoteRange;
