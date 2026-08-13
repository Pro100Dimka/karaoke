import { AudioLines, Settings2 } from "lucide-react";
import Button from "../../../components/fields/button";
import Modal from "../../../components/modal";
import { translateSaved } from "../../../i18n/runtime";
import SliderField from "../components/slider-field";
import { PLAYBACK_SPEEDS } from "../constants";

const EFFECT_FIELDS = [
  ["reverb", "Reverb"],
  ["echo", "Echo"],
  ["delay", "Delay"]
];
const VIEW_TITLES = {
  effects: [AudioLines, translateSaved("Эффекты микрофона")],
  settings: [Settings2, translateSaved("Настройки караоке")]
};
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
    ["−", translateSaved("Понизить тональность"), keyShift <= -12, -1],
    ["+", translateSaved("Повысить тональность"), keyShift >= 12, 1]
  ];
  return (
    <>
      <div className="karaoke-settings-section u-stack-4">
        <div className="karaoke-settings-section-title">
          {translateSaved("Отображение и воспроизведение")}
        </div>
        <div className="karaoke-settings-toggles karaoke-settings-toggles--playback u-stack-4">
          <div className="karaoke-setting-choice">
            <span>{translateSaved("Тональность")}</span>
            <div className="karaoke-key-stepper">
              <Button
                unstyled
                aria-label={keyButtons[0][1]}
                disabled={keyButtons[0][2]}
                onClick={() => onKeyShiftChange(Math.max(-12, keyShift - 1))}
              >
                {keyButtons[0][0]}
              </Button>
              <strong>{songKey}</strong>
              <Button
                unstyled
                aria-label={keyButtons[1][1]}
                disabled={keyButtons[1][2]}
                onClick={() => onKeyShiftChange(Math.min(12, keyShift + 1))}
              >
                {keyButtons[1][0]}
              </Button>
            </div>
            <small>
              {keyShift === 0
                ? translateSaved("Оригинальная")
                : translateSaved("{0}{1} полутонов", {
                    0: keyShift > 0 ? "+" : "",
                    1: keyShift
                  })}
            </small>
          </div>
        </div>
        <div className="karaoke-settings-sliders karaoke-settings-sliders--single u-grid-2">
          <div className="karaoke-setting-choice">
            <span>{translateSaved("Скорость")}</span>
            <div
              className="karaoke-speed-switch"
              role="group"
              aria-label={translateSaved("Скорость")}
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
            {translateSaved("Аудио и запись")}
          </Button>
        </div>
      )}
    </>
  );
}
export default function MicrophoneSettingsModal(props) {
  const { view, onClose } = props;
  const isEffectsView = view === "effects";
  const [TitleIcon, title] =
    VIEW_TITLES[isEffectsView ? "effects" : "settings"];
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={title}
      modalClassName="microphone-panel karaoke-settings-modal"
      closeClassName="karaoke-settings-close"
      closeAriaLabel={translateSaved("Закрыть настройки")}
      closeIconSize={16}
      tilt={false}
      titleProps={{
        icon: TitleIcon,
        eyebrow: isEffectsView
          ? translateSaved("МИКРОФОН")
          : translateSaved("КАРАОКЕ"),
        title,
        description: isEffectsView
          ? translateSaved("Настройте обработку микрофона.")
          : translateSaved("Настройте тональность и скорость воспроизведения.")
      }}
    >
      {isEffectsView ? (
        <EffectsView {...props} />
      ) : (
        <KaraokeSettings {...props} />
      )}
    </Modal>
  );
}
