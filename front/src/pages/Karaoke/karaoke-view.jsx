import { AlertCircle } from "lucide-react";
import { Box, Card, Stack, Typography } from "../../theme/ui";
import KaraokeConsole from "./components/console";
import KaraokeMedia from "./components/karaoke-media";
import KaraokePerformanceStage from "./components/karaoke-performance-stage";
import KaraokeStageActions from "./components/karaoke-stage-actions";
import PerformanceAnalysisModal from "./performance-analysis-modal";

export default function KaraokeView({
  containerRef,
  onMouseMove,
  mediaProps,
  recordingError,
  analysisRecordingId,
  onAnalysisClose,
  stageActionProps,
  performanceProps,
  consoleProps,
  controlsVisible,
  isPlaying
}) {
  return (
    <Box
      as="main"
      ref={containerRef}
      data-role="karaoke"
      data-playing={isPlaying || undefined}
      onMouseMove={onMouseMove}
      sx={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        color: "var(--color-text)",
        background: "var(--color-bg-deep)"
      }}
    >
      <KaraokeMedia {...mediaProps} />
      <KaraokePerformanceStage {...performanceProps} />
      <KaraokeStageActions {...stageActionProps} />
      {recordingError && (
        <Stack
          align="center"
          sx={{
            position: "absolute",
            inset: "var(--space-4) var(--space-16) auto",
            zIndex: 30,
            pointerEvents: "none"
          }}
        >
          <Card
            variant="laser"
            tilt={false}
            cardContent={{ style: { padding: "var(--space-3) var(--space-5)" } }}
          >
            <Stack direction="row" align="center" gap="var(--space-2)">
              <AlertCircle aria-hidden="true" />
              <Typography role="alert" tone="danger">
                {recordingError}
              </Typography>
            </Stack>
          </Card>
        </Stack>
      )}
      <KaraokeConsole {...consoleProps} visible={controlsVisible} />
      {analysisRecordingId && (
        <PerformanceAnalysisModal
          recordingId={analysisRecordingId}
          onClose={onAnalysisClose}
          onDone={onAnalysisClose}
          onDeleted={onAnalysisClose}
        />
      )}
    </Box>
  );
}
