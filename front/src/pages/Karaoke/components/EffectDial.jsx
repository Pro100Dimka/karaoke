import { useId, useRef } from "react";

const clamp = (value) => Math.max(0, Math.min(1, value));

export default function EffectDial({ label, value, onChange, accent = "primary" }) {
  const generatedId = useId();
  const inputId = `effect-dial-${generatedId.replace(/:/g, "")}`;
  const dragRef = useRef(null);
  const normalized = clamp(Number(value) || 0);
  const percent = Math.round(normalized * 100);
  const angle = -135 + normalized * 270;

  const changeBy = (delta) => onChange(clamp(normalized + delta));

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { y: event.clientY, value: normalized };
  };

  const handlePointerMove = (event) => {
    if (!dragRef.current) return;
    // Moving upward increases the value, like a physical amplifier knob.
    const delta = (dragRef.current.y - event.clientY) / 130;
    onChange(clamp(dragRef.current.value + delta));
  };

  const stopDrag = (event) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    changeBy(event.deltaY < 0 ? 0.05 : -0.05);
  };

  return (
    <label
      className={`karaoke-effect-dial karaoke-effect-dial--${accent}`}
      htmlFor={inputId}
      style={{
        "--dial-value": `${percent}%`,
        "--dial-angle": `${angle}deg`
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onWheel={handleWheel}
    >
      <span className="karaoke-effect-dial__label">{label}</span>
      <span className="karaoke-effect-dial__control" aria-hidden="true">
        <span className="karaoke-effect-dial__knob" />
      </span>
      <strong>{percent}%</strong>
      <input
        id={inputId}
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={normalized}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
