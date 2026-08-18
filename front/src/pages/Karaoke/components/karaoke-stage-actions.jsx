import { ArrowLeft, Maximize2, Minimize2, Radio, SlidersHorizontal } from "lucide-react";
import { IconButton } from "../../../components/ui";
import { translateSaved } from "../../../i18n/runtime";

export default function KaraokeStageActions({
  autoHideConsole,
  controlsVisible,
  hideControls,
  isFullscreen,
  isPlaying,
  isRadioPlaying,
  returnToLibrary,
  sceneTransitioning,
  showControls,
  stageActionsVisible,
  toggleFullscreen,
  toggleRadio
}) {
  const actions = [
    {
      show: true,
      icon: ArrowLeft,
      label: translateSaved("Назад в библиотеку"),
      onClick: returnToLibrary
    },
    {
      show: !!toggleFullscreen,
      icon: isFullscreen ? Minimize2 : Maximize2,
      size: 22,
      label: isFullscreen
        ? translateSaved("Выйти из полноэкранного режима")
        : translateSaved("Полноэкранный режим"),
      active: isFullscreen,
      onClick: toggleFullscreen
    },
    {
      show: !autoHideConsole,
      icon: SlidersHorizontal,
      label: controlsVisible
        ? translateSaved("Скрыть консоль")
        : translateSaved("Показать консоль"),
      active: controlsVisible,
      onClick: controlsVisible ? hideControls : showControls
    },
    {
      show: !isPlaying,
      icon: Radio,
      label: isRadioPlaying ? translateSaved("Выключить радио") : translateSaved("Включить радио"),
      active: isRadioPlaying,
      extraClass: "karaoke-stage-radio",
      onClick: toggleRadio
    }
  ];

  return (
    <div
      className={`karaoke-stage-actions ${stageActionsVisible && !sceneTransitioning ? "is-visible" : ""}`}
      aria-label={translateSaved("Навигация караоке")}
    >
      {actions.map(
        ({ show, icon, size, label, active, extraClass = "", onClick }, i) =>
          show && (
            <IconButton
              key={i}
              unstyled
              className={`karaoke-stage-action ${extraClass} ${active ? "is-active" : ""}`}
              icon={icon}
              size={size}
              label={label}
              aria-pressed={active}
              onClick={onClick}
            />
          )
      )}
    </div>
  );
}
