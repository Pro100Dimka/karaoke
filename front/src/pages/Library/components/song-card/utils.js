import {
  AudioWaveform,
  FolderOpen,
  Headphones,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { translateSaved } from "../../../../i18n/runtime";

export function formatSongKey(value) {
  if (!value) return translateSaved("Тональность определяется");
  return String(value)
    .trim()
    .replace(/\s+minor$/i, "m")
    .replace(/\s+major$/i, "maj");
}
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
  song
}) {
  const primaryAction = isReady
    ? [
        Headphones,
        translateSaved("Прослушать записи"),
        "ghost",
        () => onOpenRecordings(song),
        15
      ]
    : canManageLibrary
      ? [
          AudioWaveform,
          translateSaved("Обработать песню"),
          "primary",
          () => onProcess(song),
          16,
          {
            className: "library-song-card-process",
            disabled: isWorking
          }
        ]
      : null;
  const managementActions = canManageLibrary
    ? [
        [
          Settings2,
          translateSaved("Настройки песни"),
          "ghost",
          () => onOpenSettings(song.id),
          14
        ],
        [
          FolderOpen,
          translateSaved("Открыть папку"),
          "ghost",
          () => onOpenFolder(song),
          14
        ],
        isReady && [
          RotateCcw,
          translateSaved("Переобработать MIDI"),
          "ghost",
          () => onReprocess(song),
          14
        ],
        [
          Trash2,
          translateSaved("Удалить песню"),
          "danger",
          () => onDelete(song),
          15
        ]
      ].filter(Boolean)
    : [];
  return [primaryAction, ...managementActions].filter(Boolean);
}
