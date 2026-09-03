import {
  AudioWaveform,
  Ellipsis,
  FolderOpen,
  Headphones,
  Play,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { useRef, useState } from "react";
import { translateSaved as tr } from "../../../../i18n/runtime";
import { Box, IconButton, Popover, Stack } from "../../../../theme/ui";

export default function SongActions({
  isReady,
  isWorking,
  canManageLibrary: can,
  song,
  openKaraoke,
  onOpenRecordings,
  onProcess,
  onReprocess,
  onOpenSettings,
  onOpenFolder,
  onDelete
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef();
  const actions = [
    isReady
      ? [Play, "karaoke.play", openKaraoke]
      : can && [AudioWaveform, "library.processTheSong", () => onProcess(song), isWorking],
    isReady && [Headphones, "library.listenToRecordings", () => onOpenRecordings(song)],
    can && [Settings2, "library.songSettings", () => onOpenSettings(song.id)],
    can && [FolderOpen, "library.openFolder", () => onOpenFolder(song)],
    can && isReady && [RotateCcw, "library.reprocessMelody", () => onReprocess(song)],
    can && [Trash2, "library.deleteSong", () => onDelete(song), false, "danger"]
  ].filter(Boolean);
  const split = isReady || !can ? 2 : 1;
  const button = ([icon, key, action, disabled, variant = "contained"], close) => (
    <IconButton
      key={key}
      icon={icon}
      label={tr(key)}
      title={tr(key)}
      variant={variant}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (close) setOpen(false);
        action();
      }}
    />
  );
  return (
    <Stack direction="row" align="center" gap="var(--space-2)" sx={{ width: "auto" }}>
      {actions.slice(0, split).map(button)}
      {actions.length > split && (
        <Box sx={{ position: "relative" }}>
          <IconButton
            ref={anchor}
            icon={Ellipsis}
            variant="contained"
            label={tr("library.moreActions")}
            aria-haspopup="menu"
            aria-expanded={open}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          />
          <Popover
            open={open}
            anchorRef={anchor}
            placement="bottom-end"
            role="menu"
            onClose={() => setOpen(false)}
            aria-label={tr("library.moreActionsForSong", { 0: song.title })}
            style={{ minWidth: "auto" }}
            cardContent={{ style: { padding: "var(--space-2)" } }}
          >
            <Stack align="center" gap="var(--space-1)">
              {actions.slice(split).map((action) => button(action, true))}
            </Stack>
          </Popover>
        </Box>
      )}
    </Stack>
  );
}
