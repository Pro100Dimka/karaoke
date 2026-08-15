import KaraokeConsole from "./components/console";
import KaraokeMedia from "./components/karaoke-media";
import KaraokePerformanceStage from "./components/karaoke-performance-stage";
import KaraokeStageActions from "./components/karaoke-stage-actions";
import PerformanceAnalysisModal from "./performance-analysis-modal";

export default function KaraokeView({
  containerRef,
  className,
  onMouseMove,
  mediaProps,
  recordingError,
  analysisRecordingId,
  onAnalysisClose,
  stageActionProps,
  performanceProps,
  consoleProps
}) {
  return (
    <div ref={containerRef} className={className} onMouseMove={onMouseMove}>
      <KaraokeMedia {...mediaProps} />

      {recordingError && (
        <p className="karaoke-recording-error">{recordingError}</p>
      )}
      {analysisRecordingId && (
        <PerformanceAnalysisModal
          recordingId={analysisRecordingId}
          onClose={onAnalysisClose}
          onDone={onAnalysisClose}
          onDeleted={onAnalysisClose}
        />
      )}

      <KaraokeStageActions {...stageActionProps} />
      <KaraokePerformanceStage {...performanceProps} />
      <KaraokeConsole {...consoleProps} />
    </div>
  );
}
