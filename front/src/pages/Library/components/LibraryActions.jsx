import { Plus, UsersRound } from "lucide-react";

export default function LibraryActions({
  canManageLibrary,
  fileInputRef,
  includeFileInput = false,
  onAdd,
  onFileChosen,
  onOpenRoom,
  roomActive
}) {
  return (
    <div className="library-actions u-row u-cluster">
      {!roomActive && (
        <button className="btn btn-ghost" onClick={onOpenRoom} type="button">
          <UsersRound size={15} /> Петь вместе
        </button>
      )}
      {canManageLibrary && (
        <button className="btn btn-primary" onClick={onAdd} type="button">
          <Plus size={15} /> Добавить песню
        </button>
      )}
      {includeFileInput && (
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
          onChange={onFileChosen}
        />
      )}
    </div>
  );
}
