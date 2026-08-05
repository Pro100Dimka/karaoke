import { useId } from "react";

export default function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  disabled,
  onCommit
}) {
  const generatedId = useId();
  const inputId = `slider-${generatedId.replace(/:/g, "")}`;
  const commit = (event) => onCommit?.(Number(event.currentTarget.value));

  return (
    <label className="slider-field" htmlFor={inputId}>
      <span className="slider-field__header">
        <span>{label}</span>
        <span className="mono">{display}</span>
      </span>
      <input
        id={inputId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            commit(event);
          }
        }}
      />
    </label>
  );
}
