import { AudioLines, Settings2, X } from "lucide-react";
import Button from "../../../components/fields/button";
import { IconButton } from "../../../components/ui";
import SliderField from "../components/slider-field";
import { PLAYBACK_SPEEDS } from "../constants";

const EFFECT_FIELDS = [
  ["reverb", "Reverb"],
  ["echo", "Echo"],
  ["delay", "Delay"]
];

const VIEW_TITLES = {
  effects: [AudioLines, "Эффекты микрофона"],
  settings: [Settings2, "Настройки караоке"]
};

function ModalHeading({ view }) {
  const [Icon, title] =
    VIEW_TITLES[view === "effects" ? "effects" : "settings"];
  return (
    <div className="microphone-panel-title">
      <Icon size={15} /> {title}
    </div>
  );
}

function EffectsView({ effects, onEffectsChange, onEffectCommit }) {
  return (
    <div className="microphone-effects karaoke-effects-panel u-stack-4">
      {EFFECT_FIELDS.map(([key, label]) => (
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
  );
}

function KaraokeSettings({
  keyShift,
  speed,
  songKey,
  onClose,
  onKeyShiftChange,
  onSpeedChange,
  onOpenAudioSettings
}) {
  const keyButtons = [
    ["−", "Понизить тональность", keyShift <= -6, -1],
    ["+", "Повысить тональность", keyShift >= 6, 1]
  ];

  return (
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
                aria-label={keyButtons[0][1]}
                disabled={keyButtons[0][2]}
                onClick={() => onKeyShiftChange(Math.max(-6, keyShift - 1))}
              >
                {keyButtons[0][0]}
              </Button>
              <strong>{songKey}</strong>
              <Button
                unstyled
                aria-label={keyButtons[1][1]}
                disabled={keyButtons[1][2]}
                onClick={() => onKeyShiftChange(Math.min(6, keyShift + 1))}
              >
                {keyButtons[1][0]}
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
            <div
              className="karaoke-speed-switch"
              role="group"
              aria-label="Скорость"
            >
              {PLAYBACK_SPEEDS.map((value) => (
                <Button
                  key={value}
                  unstyled
                  className={speed === value ? "is-active" : ""}
                  onClick={() => onSpeedChange(value)}
                >
                  {value}×
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {onOpenAudioSettings && (
        <div className="microphone-controls-launcher">
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
        </div>
      )}
    </>
  );
}

export default function MicrophoneSettingsModal(props) {
  const { view, onClose } = props;
  const isEffectsView = view === "effects";

  return (
    <div className="karaoke-settings-backdrop" onMouseDown={onClose}>
      <div
        className="microphone-panel karaoke-settings-modal u-surface-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <ModalHeading view={view} />
        <IconButton
          icon={X}
          label="Закрыть настройки"
          size={16}
          className="karaoke-settings-close"
          unstyled
          onClick={onClose}
        />

        {isEffectsView ? (
          <EffectsView {...props} />
        ) : (
          <KaraokeSettings {...props} />
        )}
      </div>
    </div>
  );
}
