import { useDropzone } from "react-dropzone";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Box, Card, Typography } from "../../../theme/ui";

export default function LibraryResults({
  canManageLibrary,
  error,
  songs,
  children,
  errorText,
  fileInputRef,
  importing,
  onFileChosen
}) {
  const dropzone = useDropzone({
    accept: { "audio/*": [".mp3", ".wav", ".flac", ".m4a", ".ogg"] },
    disabled: importing || !canManageLibrary,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: onFileChosen
  });
  if (error)
    return (
      <Typography role="alert" tone="danger">
        {errorText}
      </Typography>
    );
  if (!songs.length)
    return (
      <Card sx={{ padding: "var(--space-8)", textAlign: "center" }}>
        <Typography tone="muted">{tr("Пока нет ни одной песни — добавьте первую")}</Typography>
      </Card>
    );

  return (
    <Box
      {...dropzone.getRootProps()}
      aria-label={tr("Зона добавления песен")}
      data-drop-active={dropzone.isDragActive || undefined}
    >
      {children}
      <input {...dropzone.getInputProps()} ref={fileInputRef} />
    </Box>
  );
}
