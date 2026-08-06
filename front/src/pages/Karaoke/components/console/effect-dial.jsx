import { useId, useRef } from "react";
import { RangeInput } from "../../../../components/fields";

const clamp = (value) => Math.max(0, Math.min(1, value));
const normalizeId = (id) => id.replace(/:/g, "");

export default function EffectDial({
  label,
  value,
  onChange,
  accent = "primary"
}) {
  const inputId = `effect-dial-${normalizeId(useId())}`;
  const dragRef = useRef(null);
  const normalized = clamp(Number(value) || 0);
  const percent = Math.round(normalized * 100);
  const setValue = (value) => onChange(clamp(value));
  const stopDrag = (event) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const handlers = {
    onPointerDown(event) {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = [event.clientY, normalized];
    },
    onPointerMove(event) {
      if (!dragRef.current) return;
      const [startY, startValue] = dragRef.current;
      setValue(startValue + (startY - event.clientY) / 130);
    },
    onPointerUp: stopDrag,
    onPointerCancel: stopDrag,
    onWheel(event) {
      event.preventDefault();
      setValue(normalized + (event.deltaY < 0 ? 0.05 : -0.05));
    }
  };
  return (
    <label
      {...handlers}
      className={`karaoke-effect-dial karaoke-effect-dial--${accent}`}
      htmlFor={inputId}
      style={{
        "--dial-value": `${percent}%`,
        "--dial-angle": `${-135 + normalized * 270}deg`
      }}
    >
      <span className="karaoke-effect-dial__label">{label}</span>
      <span className="karaoke-effect-dial__control" aria-hidden="true">
        <span className="karaoke-effect-dial__knob" />
      </span>
      <strong>{percent}%</strong>
      <RangeInput
        id={inputId}
        min="0"
        max="1"
        step="0.05"
        value={normalized}
        aria-label={label}
        onChange={onChange}
      />
    </label>
  );
}
