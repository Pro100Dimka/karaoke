import { AudioLines, Settings2, X } from "lucide-react";
import Button from "../../../components/fields/button";
import { IconButton } from "../../../components/ui";
import { PLAYBACK_SPEEDS } from "../constants";
import SliderField from "./SliderField";

const EFFECT_FIELDS = [
  { key: "reverb", label: "Reverb" },
  { key: "echo", label: "Echo" },
  { key: "delay", label: "Delay" }
];

export default function MicrophoneSettingsModal({
  view,
  effects,
  keyShift,
  speed,
  songKey,
  onClose,
  onEffectsChange,
  onEffectCommit,
  onKeyShiftChange,
  onSpeedChange,
  onOpenAudioSettings
}) {
  const isEffectsView = view === "effects";

  return (
    <div className="karaoke-settings-backdrop" onMouseDown={onClose}>
      <div
        className="microphone-panel karaoke-settings-modal u-surface-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="microphone-panel-title">
          {isEffectsView ? (
            <>
              <AudioLines size={15} /> Эффекты микрофона
            </>
          ) : (
            <>
              <Settings2 size={15} /> Настройки караоке
            </>
          )}
        </div>
        <IconButton
          icon={X}
          label="Закрыть настройки"
          size={16}
          className="karaoke-settings-close"
          unstyled
          onClick={onClose}
        />

        {isEffectsView ? (
          <div className="microphone-effects karaoke-effects-panel u-stack-4">
            {EFFECT_FIELDS.map(({ key, label }) => (
              <SliderField
                key={key}
                label={label}
                value={effects[key]}
                min={0}
                max={1}
                step={0.05}
                display={`${Math.round(effects[key] * 100)}%`}
                onChange={(value) => onEffectsChange(key, value)}
                onCommit={(value) => onEffectCommit(key, value)}
              />
            ))}
          </div>
        ) : (
          <>
            <div className="karaoke-settings-section u-stack-4">
              <div className="karaoke-settings-section-title">
                Отображение и воспроизведение
              </div>
              <div className="karaoke-settings-toggles karaoke-settings-toggles--playback u-stack-4">
                <div className="karaoke-setting-choice">
                  <span>Тональность</span>
                  <div className="karaoke-key-stepper">
                    <Button
                      unstyled
                      aria-label="Понизить тональность"
                      disabled={keyShift <= -6}
                      onClick={() => onKeyShiftChange(Math.max(-6, keyShift - 1))}
                    >
                      −
                    </Button>
                    <strong>{songKey}</strong>
                    <Button
                      unstyled
                      aria-label="Повысить тональность"
                      disabled={keyShift >= 6}
                      onClick={() => onKeyShiftChange(Math.min(6, keyShift + 1))}
                    >
                      +
                    </Button>
                  </div>
                  <small>
                    {keyShift === 0
                      ? "Оригинальная"
                      : `${keyShift > 0 ? "+" : ""}${keyShift} полутонов`}
                  </small>
                </div>
              </div>
              <div className="karaoke-settings-sliders karaoke-settings-sliders--single u-grid-2">
                <div className="karaoke-setting-choice">
                  <span>Скорость</span>
                  <div className="karaoke-speed-switch" role="group" aria-label="Скорость">
                    {PLAYBACK_SPEEDS.map((value) => (
                      <Button
                        key={value}
                        unstyled
                        className={speed === value ? "is-active" : ""}
                        onClick={() => onSpeedChange(value)}
                      >
                        {value === 1 ? "1×" : `${value}×`}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="microphone-controls-launcher">
              {onOpenAudioSettings && (
                <Button
                  variant="ghost"
                  icon={Settings2}
                  onClick={() => {
                    onClose();
                    onOpenAudioSettings("audio");
                  }}
                >
                  Аудио и запись
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
