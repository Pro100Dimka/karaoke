import { ArrowLeft, Radio, SlidersHorizontal } from "lucide-react";
import { IconButton } from "../../../components/ui";
import { translateSaved } from "../../../i18n/runtime";

export default function KaraokeStageActions({
  autoHideConsole,
  controlsVisible,
  hideControls,
  isPlaying,
  isRadioPlaying,
  returnToLibrary,
  sceneTransitioning,
  showControls,
  stageActionsVisible,
  toggleRadio
}) {
  return (
    <div
      className={`karaoke-stage-actions ${stageActionsVisible && !sceneTransitioning ? "is-visible" : ""}`}
      aria-label={translateSaved("Навигация караоке")}
    >
      <IconButton
        unstyled
        className="karaoke-stage-action"
        icon={ArrowLeft}
        size={25}
        label={translateSaved("Назад в библиотеку")}
        onClick={returnToLibrary}
      />
      {!autoHideConsole && (
        <IconButton
          unstyled
          className={`karaoke-stage-action ${controlsVisible ? "is-active" : ""}`}
          icon={SlidersHorizontal}
          size={25}
          label={
            controlsVisible
              ? translateSaved("Скрыть консоль")
              : translateSaved("Показать консоль")
          }
          aria-pressed={controlsVisible}
          onClick={controlsVisible ? hideControls : showControls}
        />
      )}
      {!isPlaying && (
        <IconButton
          unstyled
          className={`karaoke-stage-action karaoke-stage-radio ${isRadioPlaying ? "is-active" : ""}`}
          icon={Radio}
          size={24}
          label={
            isRadioPlaying
              ? translateSaved("Выключить радио")
              : translateSaved("Включить радио")
          }
          aria-pressed={isRadioPlaying}
          onClick={toggleRadio}
        />
      )}
    </div>
  );
}
