import { memo } from "react";
import SongCoverArt from "../../../../components/SongCoverArt";
import { translateSaved as tr } from "../../../../i18n/runtime";
import { Card, Chip, Stack, Typography } from "../../../../theme/ui";
import { getSongCardState } from "../../utils";
import SongActions from "./actions";
import SongState from "./state";

const statuses = { done: "success", error: "danger", processing: "primary" };
export default memo(
  ({
    cardIndex = 0,
    song,
    transferStatus: transfer,
    onOpenKaraoke,
    onOpenProcessing,
    ...handlers
  }) => {
    const { title, artist } = song;
    const { status, isReady, isWorking } = getSongCardState(song);
    const openKaraoke = () => isReady && onOpenKaraoke(song);
    return (
      <Card variant="laser">
        <Stack direction="row" sx={{ position: "relative", zIndex: 1, pointerEvents: "none" }}>
          <SongCoverArt {...{ cardIndex, song }} />
          <Stack
            gap="var(--space-2)"
            justify="space-between"
            sx={{ flex: 4, padding: "var(--space-4)" }}
          >
            <Stack direction="row" justify="space-between" align="start" gap="var(--space-3)">
              <Stack gap="var(--space-2)">
                <Typography variant="h4">{title}</Typography>
                <Typography variant="h5" tone="muted" sx={{ fontWeight: "normal" }}>
                  {artist || tr("library.artistNotSpecified")}
                </Typography>
              </Stack>
              <Chip tone={statuses[status] || "default"}>{tr(`status.${status}`)}</Chip>
            </Stack>
            <Stack
              direction="row"
              align="center"
              justify="space-between"
              wrap
              gap="var(--space-3)"
              sx={{ pointerEvents: "auto" }}
            >
              <SongState {...{ song, transfer, isWorking, onOpenProcessing, openKaraoke }} />
              <SongActions {...handlers} {...{ song, isReady, isWorking, openKaraoke }} />
            </Stack>
          </Stack>
        </Stack>
      </Card>
    );
  }
);
