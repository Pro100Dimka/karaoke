import { useId } from "react";
import { RangeInput } from "../../../components/fields";

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
  return (
    <label className="slider-field u-stack-2" htmlFor={inputId}>
      <span className="slider-field__header">
        <span>{label}</span>
        <span className="mono">{display}</span>
      </span>
      <RangeInput
        id={inputId}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onCommit={onCommit}
      />
    </label>
  );
}
