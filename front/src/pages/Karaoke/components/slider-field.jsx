import { useId } from "react";
import { RangeInput } from "../../../components/fields";

export default function SliderField({ label, display, ...inputProps }) {
  const inputId = `slider-${useId().replace(/:/g, "")}`;
  return (
    <label className="slider-field u-stack-2" htmlFor={inputId}>
      <span className="slider-field__header">
        <span>{label}</span>
        <span className="mono">{display}</span>
      </span>
      <RangeInput id={inputId} {...inputProps} />
    </label>
  );
}
