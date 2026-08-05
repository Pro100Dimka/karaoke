import { Plus, UsersRound } from "lucide-react";
import { Card } from "../../../components/ui";

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
        <Card
          as="button"
          variant="glass"
          className="btn btn-ghost library-action-card"
          onClick={onOpenRoom}
          type="button"
        >
          <UsersRound size={15} /> Петь вместе
        </Card>
      )}
      {canManageLibrary && (
        <Card
          as="button"
          variant="glass"
          className="btn btn-primary library-action-card"
          onClick={onAdd}
          type="button"
        >
          <Plus size={15} /> Добавить песню
        </Card>
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
