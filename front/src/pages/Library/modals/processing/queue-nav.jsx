import { ChevronLeft, ChevronRight } from "lucide-react";
import { translateSaved as tr } from "../../../../i18n/runtime";
import { IconButton, Stack, Typography } from "../../../../theme/ui";

export default ({ song, queue, index, onSelect }) => {
  if (queue.length < 2) return null;
  const button = (offset, Icon, label) => (
    <IconButton
      label={tr(label)}
      variant="outline"
      disabled={!queue[index + offset]}
      onClick={() => onSelect(queue[index + offset])}
    >
      <Icon />
    </IconButton>
  );
  return (
    <Stack direction="row" align="center" justify="space-between" gap={1}>
      {button(-1, ChevronLeft, "library.previousSong")}
      <Stack align="center" gap={0.1}>
        <Typography sx={{ fontWeight: 750 }}>
          {tr("library.songOf", { 0: index + 1, 1: queue.length })}
        </Typography>
        <Typography variant="caption" tone="muted">
          {song.artist || tr("library.artistNotSpecified")}
        </Typography>
      </Stack>

      {button(1, ChevronRight, "library.nextSong")}
    </Stack>
  );
};
