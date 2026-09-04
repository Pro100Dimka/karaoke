import { memo } from "react";
import { ArrowLeft, Radio, SlidersHorizontal } from "lucide-react";
import { translateSaved as t } from "../../i18n/runtime";
import { IconButton, Stack } from "../../theme/ui";

function KaraokeStageActions({
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
    ["back", ArrowLeft, t("karaoke.backToTheLibrary"), null, returnToLibrary, true],
    [
      "console",
      SlidersHorizontal,
      controlsVisible ? t("karaoke.hideConsole") : t("karaoke.showConsole"),
      controlsVisible,
      controlsVisible ? () => hideControls(true) : () => showControls(true),
      true
    ],
    [
      "radio",
      Radio,
      isRadioPlaying ? t("karaoke.turnOffTheRadio") : t("karaoke.turnOnTheRadio"),
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
      aria-label={t("karaoke.karaokeNavigation")}
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
              aria-pressed={typeof active === "boolean" ? active : undefined}
              variant={active ? "contained" : "outline"}
              iconSize={50}
              onClick={onClick}
            />
          )
      )}
    </Stack>
  );
}

export default memo(KaraokeStageActions);
