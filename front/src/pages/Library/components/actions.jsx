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
  const actions = [
    !roomActive && [UsersRound, "Петь вместе", "btn-ghost", onOpenRoom],
    canManageLibrary && [Plus, "Добавить песню", "btn-primary", onAdd]
  ].filter(Boolean);
  return (
    <div className="library-actions u-row u-cluster">
      {actions.map(([Icon, text, className, onClick]) => (
        <Card
          key={text}
          as="button"
          variant="glass"
          className={`btn ${className} library-action-card`}
          onClick={onClick}
        >
          <Icon size={15} />
          {text}
        </Card>
      ))}
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
