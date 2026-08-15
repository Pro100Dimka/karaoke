import { AudioWaveform, FolderOpen, Headphones, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { translateSaved } from "../../../../i18n/runtime";

export function formatSongKey(value) {
  const key = value ? String(value).trim() : "";
  if (!key) return translateSaved("Тональность определяется");
  return key.replace(/\s+minor$/i, "m").replace(/\s+major$/i, "maj");
}
function getPrimaryAction({
  canManageLibrary,
  isReady,
  isWorking,
  onOpenRecordings,
  onProcess,
  song
}) {
  if (isReady) {
    return [
      Headphones,
      translateSaved("Прослушать записи"),
      "outline",
      () => onOpenRecordings(song),
      15
    ];
  }
  if (!canManageLibrary) return null;
  return [
    AudioWaveform,
    translateSaved("Обработать песню"),
    "outline",
    () => onProcess(song),
    16,
    { className: "library-song-card-process", disabled: isWorking }
  ];
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
  const primaryAction = getPrimaryAction({
    canManageLibrary,
    isReady,
    isWorking,
    onOpenRecordings,
    onProcess,
    song
  });
  const managementActions = canManageLibrary
    ? [
        [
          Settings2,
          translateSaved("Настройки песни"),
          "outline",
          () => onOpenSettings(song.id),
          14
        ],
        [FolderOpen, translateSaved("Открыть папку"), "outline", () => onOpenFolder(song), 14],
        isReady && [
          RotateCcw,
          translateSaved("Переобработать MIDI"),
          "outline",
          () => onReprocess(song),
          14
        ],
        [Trash2, translateSaved("Удалить песню"), "danger", () => onDelete(song), 15]
      ]
    : [];
  return [primaryAction, ...managementActions].filter(Boolean);
}
