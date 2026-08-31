import {
  AudioWaveform,
  FolderOpen,
  Headphones,
  Play,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { translateSaved as tr } from "../../i18n/runtime";
import { ProcessingSignal } from "../../theme/ui";

export { SongCoverArt } from "../../components/SongCoverArt";

export { ProcessingSignal };

export function getSongActions({
  canManageLibrary,
  isReady,
  isWorking,
  onDelete,
  onOpenFolder,
  onOpenRecordings,
  onOpenSettings,
  onProcess,
  onReprocess,
  activate,
  song
}) {
  return [
    ...(isReady
      ? [
          [Play, tr("karaoke.play"), "contained", activate],
          [Headphones, tr("library.listenToRecordings"), "contained", () => onOpenRecordings(song)]
        ]
      : (canManageLibrary && [
          [
            AudioWaveform,
            tr("library.processTheSong"),
            "contained",
            () => onProcess(song),
            isWorking
          ]
        ]) ||
        []),
    canManageLibrary && [
      Settings2,
      tr("library.songSettings"),
      "contained",
      () => onOpenSettings(song.id)
    ],
    canManageLibrary && [
      FolderOpen,
      tr("library.openFolder"),
      "contained",
      () => onOpenFolder(song)
    ],
    canManageLibrary &&
      isReady && [RotateCcw, tr("library.reprocessMelody"), "contained", () => onReprocess(song)],
    canManageLibrary && [Trash2, tr("library.deleteSong"), "danger", () => onDelete(song)]
  ].filter(Boolean);
}
