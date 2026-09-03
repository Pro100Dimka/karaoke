import { AlertCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRadio } from "../../contexts/radio";
import { Box, Card, Stack, Typography } from "../../theme/ui";
import KaraokeStageActions from "./actions";
import PerformanceAnalysisModal from "./analysis-modal";
import KaraokeConsole from "./console";
import useKaraokeControls from "./hooks/useKaraokeControls";
import useKaraokeHotkeys from "./hooks/useKaraokeHotkeys";
import useKaraokeSceneFlow from "./hooks/useKaraokeSceneFlow";
import useKaraokeStageLayout from "./hooks/useKaraokeStageLayout";
import KaraokeMedia from "./media";
import KaraokePerformanceStage from "./performance-stage";

export default function KaraokeView({
  autoHideEnabled,
  currentTime,
  duration,
  isPlaying,
  recordingSessionId,
  recordingError,
  analysisRecordingId,
  clearAnalysis,
  sceneOptions,
  transport,
  mediaProps,
  performanceProps,
  consoleProps
}) {
  const containerRef = useRef(null);
  const [clipAvailable, setClipAvailable] = useState(false);
  const {
    isPlaying: isRadioPlaying,
    setRecordingActive,
    toggle: toggleRadio,
    turnOff: turnOffRadio,
    turnOn: turnOnRadio
  } = useRadio();
  const controls = useKaraokeControls({ autoHideEnabled });
  const { playbackEndedRef, ...flowOptions } = sceneOptions;
  const scene = useKaraokeSceneFlow({
    ...flowOptions,
    hideControls: controls.hideControls,
    isPlaying,
    isRadioPlaying,
    returnToLibrary: transport.returnToLibrary,
    setRecordingActive,
    showControls: controls.showControls,
    stop: transport.stop,
    togglePlay: transport.togglePlay,
    turnOffRadio,
    turnOnRadio
  });

  playbackEndedRef.current = scene.handleStop;

  useEffect(() => {
    setRecordingActive(Boolean(recordingSessionId) && isPlaying);
  }, [isPlaying, recordingSessionId, setRecordingActive]);

  useEffect(() => () => setRecordingActive(false), [setRecordingActive]);

  useKaraokeHotkeys({
    scopeRef: containerRef,
    currentTime,
    duration,
    onTogglePlay: scene.handleTogglePlay,
    onSeek: transport.seekTo,
    onStop: scene.handleStop
  });
  useKaraokeStageLayout(containerRef);

  const closeAnalysis = () => {
    clearAnalysis();
    scene.navigateToLibraryFromBlackout();
  };
  const controlsVisible = controls.controlsVisible && !scene.sceneTransitioning;

  return (
    <Box
      as="main"
      ref={containerRef}
      data-role="karaoke"
      data-playing={isPlaying || undefined}
      onMouseMove={(event) => {
        if (!scene.sceneTransitioning && controls.revealControls(event)) {
          scene.revealStageActions();
        }
      }}
      sx={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        color: "var(--color-text)",
        background: "var(--color-bg-deep)"
      }}
    >
      <KaraokeMedia {...mediaProps} onClipAvailabilityChange={setClipAvailable} />
      <KaraokePerformanceStage
        {...performanceProps}
        hasSongClip={clipAvailable}
        sceneBlackout={scene.sceneBlackout}
        sceneIntroVisible={scene.sceneIntroVisible}
      />
      <KaraokeStageActions
        controlsVisible={controls.controlsVisible}
        hideControls={controls.hideControls}
        isPlaying={isPlaying}
        isRadioPlaying={isRadioPlaying}
        returnToLibrary={transport.returnToLibrary}
        sceneTransitioning={scene.sceneTransitioning}
        showControls={controls.showControls}
        stageActionsVisible={scene.stageActionsVisible}
        toggleRadio={toggleRadio}
      />

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
              <AlertCircle aria-hidden />
              <Typography role="alert" tone="danger">
                {recordingError}
              </Typography>
            </Stack>
          </Card>
        </Stack>
      )}

      <KaraokeConsole
        {...consoleProps}
        autoHideEnabled={autoHideEnabled}
        visible={controlsVisible}
        onClose={controls.hideControls}
        onStop={scene.handleStop}
        onTogglePlay={scene.handleTogglePlay}
      />

      {analysisRecordingId && (
        <PerformanceAnalysisModal
          recordingId={analysisRecordingId}
          onClose={closeAnalysis}
          onDone={closeAnalysis}
          onDeleted={closeAnalysis}
        />
      )}
    </Box>
  );
}
