import { BarChart3, Music2, Trash2 } from "lucide-react";
import { api } from "../../../api/client";
import { AudioPlayer } from "../../../components/AudioPlayer";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Box, Card, IconButton, Modal, Stack, Typography } from "../../../theme/ui";

export default ({ song, recordings = [], error, onAnalyze, onClose, onDelete }) => {
  if (!song) return null;
  const controls = (recording) =>
    [
      [BarChart3, "library.analyzeRecord", "outline", onAnalyze],
      [Trash2, "karaoke.deleteEntry", "danger", onDelete]
    ].map(([Icon, label, variant, handler]) => (
      <IconButton
        key={label}
        label={tr(label)}
        variant={variant}
        onClick={() => handler(recording)}
      >
        <Icon />
      </IconButton>
    ));

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={tr("library.songPerformances", { 0: song.title })}
      titleProps={{
        icon: Music2,
        eyebrow: tr("library.songPerformances2"),
        title: song.title,
        description: tr("library.listenToPerformancesRunAnalyzesAndManageRecordings")
      }}
    >
      <Stack gap={0.75} sx={{ padding: "var(--space-5)" }}>
        {recordings.map((recording) => (
          <Card
            key={recording.id}
            sx={{
              padding: "var(--space-3)",
              background: "unset",
              border: "unset",
              boxShadow: "unset",
              backdropFilter: "unset"
            }}
          >
            <Stack direction="row" align="center" gap={0.75}>
              <Box sx={{ flex: 1 }}>
                <AudioPlayer
                  src={api.getPerformanceFileUrl(recording.id)}
                  initialDuration={recording.duration_sec}
                />
              </Box>
              {controls(recording)}
            </Stack>
          </Card>
        ))}
        {!recordings.length && !error && (
          <Typography tone="muted" sx={{ textAlign: "center", padding: "var(--space-8)" }}>
            {tr("library.thereAreNoRecordedPerformancesForThisSongYet")}
          </Typography>
        )}
        {error && (
          <Typography role="alert" tone="danger">
            {error instanceof Error ? error.message : String(error)}
          </Typography>
        )}
      </Stack>
    </Modal>
  );
};
