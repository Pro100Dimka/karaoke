import { Plus, Search, UsersRound } from "lucide-react";
import { Card } from "../../../../components/ui";
import { Stack } from "../../../../theme/ui";

export default function LibraryActions({
  canManageLibrary,
  fileInputRef,
  includeFileInput = false,
  importing = false,
  onAdd,
  onFileChosen,
  onOpenRoom,
  roomActive,
  query,
  setQuery
}) {
  const actions = [
    !roomActive && [UsersRound, "Петь вместе", "btn-ghost", onOpenRoom],
    canManageLibrary && [Plus, "Добавить песню", "btn-primary", onAdd]
  ].filter(Boolean);
  return (
    <Stack direction="row" justify="space-between">
      <Card
        className="library-search"
        variant="neon"
        cardPanel={{ style: { background: "unset" } }}
      >
        <Search className="library-search-icon" size={14} />
        <input
          className="input library-search-input"
          placeholder="Поиск..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Card>
      <div className="library-actions u-row u-cluster">
        {actions.map(([Icon, text, className, onClick]) => (
          <Card
            key={text}
            as="button"
            variant="glass"
            className={`btn ${className} library-action-card`}
            onClick={onClick}
            disabled={importing && text === "Добавить песню"}
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
            disabled={importing}
          />
        )}
      </div>
    </Stack>
  );
}
