import { Plus, Search, UsersRound } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Button, Card, InputBase, Stack } from "../../../theme/ui";

export default function LibraryActions({
  canManageLibrary,
  fileInputRef,
  importing,
  onAdd,
  onFileChosen,
  onOpenRoom,
  roomActive,
  query,
  setQuery
}) {
  const dropzone = useDropzone({
    accept: { "audio/*": [".mp3", ".wav", ".flac", ".m4a", ".ogg"] },
    disabled: importing || !canManageLibrary,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: onFileChosen
  });
  return (
    <Stack
      direction="row"
      gap="1rem"
      {...dropzone.getRootProps()}
      aria-label={tr("Зона добавления песен")}
      data-drop-active={dropzone.isDragActive || undefined}
    >
      <Card
        variant="laser"
        tilt={false}
        sx={{ containerType: "normal", flex: 1 }}
        cardContent={{
          style: {
            display: "flex",
            alignItems: "center",
            padding: "var(--space-4) var(--space-5)",
            gap: "var(--space-4)"
          }
        }}
      >
        <Search aria-hidden="true" />
        <InputBase
          component="input"
          aria-label={tr("Поиск")}
          placeholder={tr("Поиск...")}
          value={query}
          onChange={(event) => setQuery(event.target.value, event)}
          sx={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 0,
            background: "transparent",
            color: "var(--ui-text)",
            font: "inherit"
          }}
        />
      </Card>
      <Stack direction="row" gap="1rem" sx={{ flex: 1 }}>
        {!roomActive && (
          <Button
            size="lg"
            variant="outline"
            fullWidth
            startIcon={<UsersRound />}
            onClick={onOpenRoom}
          >
            {tr("Петь вместе")}
          </Button>
        )}
        {canManageLibrary && (
          <Button
            size="lg"
            variant="contained"
            startIcon={<Plus />}
            fullWidth
            disabled={importing}
            onClick={onAdd}
          >
            {tr("Добавить песню")}
          </Button>
        )}
        <input {...dropzone.getInputProps()} ref={fileInputRef} />
      </Stack>
    </Stack>
  );
}
