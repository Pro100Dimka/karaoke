import { memo } from "react";
import SongCoverArt from "../../../components/SongCoverArt";
import { translateSaved as t } from "../../../i18n/runtime";
import { Card, Chip, Stack, Typography } from "../../../theme/ui";

export default memo(({ visible, songId, scene }) => {
  const chips = [
    scene?.genre,
    scene?.key,
    scene?.tempo && t("common.bpm", { 0: scene.tempo }),
    scene?.difficulty
  ].filter(Boolean);

  return (
    <Stack
      aria-hidden={!visible}
      align="center"
      justify="center"
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 9,
        opacity: visible ? 1 : 0,
        pointerEvents: "none",
        transform: visible ? "none" : "scale(.98)",
        transition:
          "opacity var(--motion-duration-slow) var(--motion-easing-standard), transform var(--motion-duration-slow) var(--motion-easing-spring)"
      }}
    >
      <Card variant="laser" tilt={false}>
        <Stack direction="row">
          {songId && <SongCoverArt song={{ id: songId }} sx={{ flex: 1 }} />}
          <Stack align="center" justify="space-between" py="var(--space-8)" sx={{ flex: 4 }}>
            <Typography variant="h6" tone="muted">
              {t("karaoke.nowItWillSound")}
            </Typography>
            <Typography variant="h2">{scene?.title || t("karaoke.karaoke")}</Typography>
            {scene?.artist && (
              <Typography variant="h5" tone="muted">
                {scene.artist}
              </Typography>
            )}
            <Stack direction="row" justify="center" wrap gap="var(--space-2)">
              {chips.map((value, index) => (
                <Chip key={`${index}-${value}`} size="lg">
                  {value}
                </Chip>
              ))}
            </Stack>
          </Stack>
        </Stack>
      </Card>
    </Stack>
  );
});
