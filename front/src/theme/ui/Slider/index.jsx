import { forwardRef } from "react";
import useControllable from "../_internal/useControllable";
import cx from "../_internal/cx";
import mergeSx from "../_internal/sx";
import "./slider.css";

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, Number(value) || 0));

const COMMIT_KEYS = new Set([
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"
]);

const Slider = forwardRef(function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  defaultValue,
  disabled = false,
  size = "md",
  showValue = false,
  className,
  sx,
  style,
  onInput,
  onChange,
  onCommit,
  ...props
}, ref) {
  const [current, setCurrent] = useControllable(
    value,
    defaultValue ?? min,
    onChange
  );

  const safe = clamp(current, min, max);
  const percent = ((safe - min) / Math.max(.000001, max - min)) * 100;

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
      style={mergeSx({ "--slider-value": `${percent}%`, ...sx }, style)}
      onInput={event => onInput?.(Number(event.currentTarget.value), event)}
      onChange={event => setCurrent(Number(event.currentTarget.value), event)}
      onPointerUp={event => onCommit?.(Number(event.currentTarget.value), event)}
      onKeyUp={event => {
        if (COMMIT_KEYS.has(event.key))
          onCommit?.(Number(event.currentTarget.value), event);
      }}
      {...props}
    />
  );

  return showValue ? (
    <span className="ui-slider-wrap" data-disabled={disabled || undefined}>
      {input}
      <output className="ui-slider-value">{safe}</output>
    </span>
  ) : input;
});

export default Slider;
