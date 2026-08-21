import { useId, useRef } from "react";
import { clamp } from "../../utils/math";
import { getRotaryDragValue, getRotaryWheelValue } from "./rotary-knob-utils";

const normalizeId = (id) => id.replace(/:/g, "");

export default function RotaryKnob({
  label,
  value = 0,
  min = 0,
  max = 1,
  step = 0.05,
  defaultValue = min,
  onChange,
  onCommit,
  accent = "primary"
}) {
  const inputId = `rotary-knob-${normalizeId(useId())}`;
  const dragRef = useRef(null);
  const normalized = clamp(Number(value) || 0, min, max);
  const range = max - min || 1;
  const ratio = (normalized - min) / range;
  const percent = Math.round(ratio * 100);
  const setValue = (nextValue) => {
    const next = clamp(nextValue, min, max);
    onChange?.(next);
    return next;
  };
  const stopDrag = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag) onCommit?.(drag.value);
  };

  return (
    <label
      className={`karaoke-effect-dial karaoke-effect-dial--${accent}`}
      htmlFor={inputId}
      style={{
        display: "flex",
        flexDirection: "column",
        touchAction: "none",
        userSelect: "none",
        "--dial-value": `${percent}%`,
        "--dial-angle": `${-135 + ratio * 270}deg`
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        const next = setValue(defaultValue);
        onCommit?.(next);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = { lastY: event.clientY, value: normalized };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        drag.value = setValue(
          getRotaryDragValue({
            value: drag.value,
            lastY: drag.lastY,
            clientY: event.clientY,
            min,
            max,
            fine: event.shiftKey
          })
        );
        drag.lastY = event.clientY;
      }}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onWheel={(event) => {
        event.preventDefault();
        setValue(
          getRotaryWheelValue({
            value: normalized,
            deltaY: event.deltaY,
            step,
            min,
            max,
            fine: event.shiftKey
          })
        );
      }}
    >
      <span className="karaoke-effect-dial__label">{label}</span>
      <span className="karaoke-effect-dial__control" aria-hidden="true">
        <span className="karaoke-effect-dial__knob" />
      </span>
      <strong>{percent}%</strong>
      {/* <RangeInput
        id={inputId}
        min={min}
        max={max}
        step={step}
        value={normalized}
        aria-label={label}
        aria-valuetext={`${percent}%`}
        onChange={onChange}
        onCommit={onCommit}
      /> */}
    </label>
  );
}
