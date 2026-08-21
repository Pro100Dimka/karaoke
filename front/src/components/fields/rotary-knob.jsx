import { useEffect, useId, useRef, useState } from "react";
import { clamp } from "../../utils/math";
import {
  getRotaryDragValue,
  getRotaryPointerValue,
  getRotaryWheelValue
} from "./rotary-knob-utils";

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
  const [editing, setEditing] = useState(false);
  const [draftPercent, setDraftPercent] = useState("");
  const normalized = clamp(Number(value) || 0, min, max);
  const valueRef = useRef(normalized);
  useEffect(() => {
    if (!dragRef.current) valueRef.current = normalized;
  }, [normalized]);
  const range = max - min || 1;
  const ratio = (normalized - min) / range;
  const percent = Math.round(ratio * 100);
  const setValue = (nextValue) => {
    const next = clamp(nextValue, min, max);
    valueRef.current = next;
    onChange?.(next);
    return next;
  };
  const stopDrag = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag) onCommit?.(drag.value);
  };
  const commitPercent = () => {
    const number = Number(draftPercent);
    if (Number.isFinite(number)) {
      const next = setValue(min + (clamp(number, 0, 100) / 100) * range);
      onCommit?.(next);
    }
    setEditing(false);
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
      onPointerDown={(event) => {
        if (event.button !== 0 || event.target.closest("input")) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const control = event.target.closest(".karaoke-effect-dial__control");
        const next = control
          ? setValue(
              getRotaryPointerValue({
                clientX: event.clientX,
                clientY: event.clientY,
                rect: control.getBoundingClientRect(),
                min,
                max
              })
            )
          : valueRef.current;
        dragRef.current = { lastY: event.clientY, value: next };
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
      onLostPointerCapture={stopDrag}
      onWheel={(event) => {
        event.preventDefault();
        const next = setValue(
          getRotaryWheelValue({
            value: valueRef.current,
            deltaY: event.deltaY,
            step,
            min,
            max,
            fine: event.shiftKey
          })
        );
        onCommit?.(next);
      }}
    >
      <span className="karaoke-effect-dial__label">{label}</span>
      <span
        className="karaoke-effect-dial__control"
        aria-hidden="true"
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = setValue(defaultValue);
          onCommit?.(next);
        }}
      >
        <span className="karaoke-effect-dial__knob" />
      </span>
      {editing ? (
        <span className="karaoke-effect-dial__value-editor">
          <input
            autoFocus
            aria-label={`${label}, ${percent}%`}
            inputMode="decimal"
            min="0"
            max="100"
            type="number"
            value={draftPercent}
            onBlur={commitPercent}
            onChange={(event) => setDraftPercent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitPercent();
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <span>%</span>
        </span>
      ) : (
        <strong
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDraftPercent(String(percent));
            setEditing(true);
          }}
        >
          {percent}%
        </strong>
      )}
      <input
        style={{
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          height: 1,
          overflow: "hidden",
          pointerEvents: "none",
          position: "absolute",
          whiteSpace: "nowrap",
          width: 1
        }}
        type="range"
        id={inputId}
        min={min}
        max={max}
        step={step}
        value={normalized}
        aria-label={label}
        aria-valuetext={`${percent}%`}
        onChange={(event) => {
          const next = setValue(Number(event.target.value));
          onCommit?.(next);
        }}
      />
    </label>
  );
}
