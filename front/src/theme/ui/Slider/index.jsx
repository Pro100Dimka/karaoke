import { forwardRef } from "react";
import Field from "../_internal/Field";
import cx from "../_internal/cx";
import mergeSx from "../_internal/sx";
import useControllable from "../_internal/useControllable";
import "./slider.css";

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, Number(value) || 0));

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
      showValue = false,
      className,
      fieldClassName,
      sx,
      style,
      onInput,
      onChange,
      fieldSx,
      fieldStyle,
      onCommit,
      ...props
    },
    ref
  ) => {
    const [current, setCurrent] = useControllable(
      value,
      defaultValue ?? min,
      onChange
    );

    const safe = clamp(current, min, max);
    const percent = ((safe - min) / Math.max(0.000001, max - min)) * 100;

    const control = (fieldProps) => {
      const input = (
        <input
          ref={ref}
          type="range"
          className={cx("ui-slider", "ui-disabled", className)}
          data-size={size}
          min={min}
          max={max}
          step={step}
          value={safe}
          disabled={disabled}
          required={required}
          style={mergeSx({ "--slider-value": `${percent}%`, ...sx }, style)}
          onInput={(event) =>
            onInput?.(Number(event.currentTarget.value), event)
          }
          onChange={(event) =>
            setCurrent(Number(event.currentTarget.value), event)
          }
          onPointerUp={(event) =>
            onCommit?.(Number(event.currentTarget.value), event)
          }
          onKeyUp={(event) => {
            if (COMMIT_KEYS.has(event.key))
              onCommit?.(Number(event.currentTarget.value), event);
          }}
          {...fieldProps}
          {...props}
        />
      );

      return showValue ? (
        <span className="ui-slider-wrap" data-disabled={disabled || undefined}>
          {input}
          <output className="ui-slider-value" htmlFor={fieldProps?.id}>
            {safe}
          </output>
        </span>
      ) : (
        input
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
        sx={fieldSx}
        style={fieldStyle}
        disabled={disabled}
        className={fieldClassName}
      >
        {control}
      </Field>
    ) : (
      control({ id })
    );
  }
);

export default Slider;
