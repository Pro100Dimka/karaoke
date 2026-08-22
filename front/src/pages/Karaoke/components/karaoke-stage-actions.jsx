import { ArrowLeft, Radio, SlidersHorizontal } from "lucide-react";
import { translateSaved as t } from "../../../i18n/runtime";
import { IconButton, Stack } from "../../../theme/ui";

export default function KaraokeStageActions({
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
  const actions = [
    ["back", ArrowLeft, t("Назад в библиотеку"), false, returnToLibrary, true],
    [
      "console",
      SlidersHorizontal,
      controlsVisible ? t("Скрыть консоль") : t("Показать консоль"),
      controlsVisible,
      controlsVisible ? hideControls : showControls,
      true
    ],
    [
      "radio",
      Radio,
      isRadioPlaying ? t("Выключить радио") : t("Включить радио"),
      isRadioPlaying,
      toggleRadio,
      !isPlaying
    ]
  ];
  return (
    <Stack
      as="nav"
      data-role="stage-actions"
      direction="row"
      gap="var(--space-3)"
      aria-label={t("Навигация караоке")}
      sx={{
        position: "absolute",
        inset: "var(--space-4) auto auto var(--space-4)",
        zIndex: 20,
        opacity: (stageActionsVisible || !controlsVisible) && !sceneTransitioning ? 1 : 0,
        pointerEvents:
          (stageActionsVisible || !controlsVisible) && !sceneTransitioning ? "auto" : "none",
        transition: "opacity var(--motion-duration-normal) var(--motion-easing-standard)"
      }}
    >
      {actions.map(
        ([id, icon, label, active, onClick, show]) =>
          show && (
            <IconButton
              key={id}
              data-action={id}
              icon={icon}
              label={label}
              title={label}
              aria-pressed={active}
              variant={active ? "solid" : "outline"}
              size="lg"
              onClick={onClick}
            />
          )
      )}
    </Stack>
  );
}
