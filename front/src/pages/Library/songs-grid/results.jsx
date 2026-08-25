import { useDropzone } from "react-dropzone";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Box, Card, Stack, Typography } from "../../../theme/ui";

export default function LibraryResults({
  canManageLibrary,
  error,
  songs,
  children,
  errorText,
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
      <Stack align="center" justify="center" sx={{ minHeight: "30vh" }}>
        <Card
          sx={{ textAlign: "center" }}
          cardContent={{ style: { padding: "var(--space-5)" } }}
          variant="laser"
        >
          <Typography tone="muted" variant="h4">
            {tr("Пока нет ни одной песни — добавьте первую")}
          </Typography>
        </Card>
      </Stack>
    );

  return (
    <Box
      {...dropzone.getRootProps()}
      aria-label={tr("Зона добавления песен")}
      data-drop-active={dropzone.isDragActive || undefined}
    >
      {children}
    </Box>
  );
}
