import { Mic } from "lucide-react";
import EffectDial from "../EffectDial";
import SliderField from "../SliderField";
import { EFFECT_FIELDS, METER_BARS, MIXER_FIELDS } from "./config";
import { clamp } from "./utils";

function MicrophoneMeter({ level }) {
  return (
    <span className="karaoke-microphone-meter" aria-hidden="true">
      {METER_BARS.map((index) => (
        <i
          key={index}
          style={{
            "--meter-level": `${clamp(level * 100 - index * 6 + 34, 18, 100)}%`
          }}
        />
      ))}
    </span>
  );
}

export default function MixerPanel({
  microphoneLevel,
  volumes,
  onVolumeChange,
  onMicrophoneCommit,
  microphoneEffects,
  onEffectChange
}) {
  const level = clamp(microphoneLevel, 0, 1);

  return (
    <section
      className="karaoke-console-panel karaoke-mixer-panel"
      style={{ "--microphone-level": level }}
    >
      <div className="karaoke-console-title">
        <Mic size={18} />
        <strong>Микшер</strong>
        <MicrophoneMeter level={level} />
      </div>

      <div className="karaoke-mixer-body">
        <div className="karaoke-quick-mixer karaoke-quick-mixer--vertical">
          {MIXER_FIELDS.map(([key, label]) => {
            const value = volumes[key] ?? 0;

            return (
              <SliderField
                key={key}
                label={label}
                value={value}
                min={0}
                max={1}
                step={0.05}
                display={`${Math.round(value * 100)}%`}
                onChange={onVolumeChange[key]}
                onCommit={key === "microphone" ? onMicrophoneCommit : undefined}
              />
            );
          })}
        </div>

        <div
          className="karaoke-mixer-effects"
          aria-label="Быстрые эффекты микрофона"
        >
          {EFFECT_FIELDS.map(([key, label, accent]) => (
            <EffectDial
              key={key}
              label={label}
              value={microphoneEffects[key]}
              accent={accent}
              onChange={(value) => onEffectChange(key, value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
