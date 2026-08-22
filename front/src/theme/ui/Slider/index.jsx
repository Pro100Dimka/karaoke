import { forwardRef, useId } from "react";
import { clamp as clampRange } from "../../../utils/math";
import OutlinedInput from "../OutlinedInput";
import FloatingLabel from "../_internal/FloatingLabel";
import cx from "../_internal/cx";
import mergeSx from "../_internal/sx";
import useControllable from "../_internal/useControllable";
import "./slider.css";

const clamp = (value, min, max) => clampRange(Number(value) || 0, min, max);

const COMMIT_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End"
]);

const Slider = forwardRef(
  (
    {
      id,
      label,
      tooltip,
      hint,
      error,
      required = false,
      min = 0,
      max = 100,
      step = 1,
      value,
      defaultValue,
      disabled = false,
      size = "md",
      orientation = "horizontal",
      showValue = true,
      formatValue = String,
      className,
      fieldClassName,
      sx,
      style,
      onInput,
      onChange,
      controlSx,
      controlStyle,
      fieldSx,
      fieldStyle,
      onCommit,
      ...props
    },
    ref
  ) => {
    const uid = useId().replace(/:/g, "");
    const controlId = id || `ui-slider-${uid}`;
    const hintId = hint ? `${controlId}-hint` : undefined;
    const errorId = error ? `${controlId}-error` : undefined;
    const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
    const [current, setCurrent] = useControllable(
      value,
      defaultValue ?? min,
      onChange
    );

    const safe = clamp(current, min, max);
    const percent = ((safe - min) / Math.max(0.000001, max - min)) * 100;

    const input = (
      <input
        ref={ref}
        id={controlId}
        type="range"
        className={cx("ui-slider", "ui-disabled", className)}
        data-size={size}
        min={min}
        max={max}
        step={step}
        value={safe}
        disabled={disabled}
        required={required}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        aria-orientation={orientation}
        data-orientation={orientation}
        style={mergeSx({ "--slider-value": `${percent}%`, ...sx }, style)}
        onInput={(event) => onInput?.(Number(event.currentTarget.value), event)}
        onChange={(event) => setCurrent(Number(event.currentTarget.value), event)}
        onPointerUp={(event) => onCommit?.(Number(event.currentTarget.value), event)}
        onKeyUp={(event) => {
          if (COMMIT_KEYS.has(event.key)) onCommit?.(Number(event.currentTarget.value), event);
        }}
        {...props}
      />
    );
    const control = (
      <span
        className="ui-slider-control"
        data-disabled={disabled || undefined}
        data-orientation={orientation}
        style={mergeSx(controlSx, controlStyle)}
      >
        {input}
        {showValue && (
          <output className="ui-slider-value" htmlFor={controlId}>
            {formatValue(safe)}
          </output>
        )}
      </span>
    );

    if (!label && !hint && !error) return control;

    return (
      <div
        className={cx("ui-field", "ui-slider-field", fieldClassName)}
        data-disabled={disabled || undefined}
        data-error={!!error || undefined}
        style={mergeSx(fieldSx, fieldStyle)}
      >
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
          className="ui-slider-frame"
          data-filled
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
  }
);

export default Slider;
