import { useId } from "react";

export default function EffectDial({ label, value, onChange, accent = "primary" }) {
  const generatedId = useId();
  const inputId = `effect-dial-${generatedId.replace(/:/g, "")}`;
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);

  return (
    <label
      className={`karaoke-effect-dial karaoke-effect-dial--${accent}`}
      htmlFor={inputId}
      style={{ "--dial-value": `${percent}%` }}
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
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
