import { lazy, Suspense } from "react";
import { OnlineRoomModal } from "../../components/OnlineRoomModal";
import { translateSaved as tr } from "../../i18n/runtime";
import { Box, Stack } from "../../theme/ui";
import PerformanceAnalysisModal from "../Karaoke/performance-analysis-modal";
import { LibraryBackdrop, LibraryResults, SongGrid } from "./components";
import LibraryHero from "./hero";
import { AddSongsModal, ProcessingModal, RecordingsModal } from "./modals";
import useLibrary from "./use-library";

const SongSettings = lazy(() => import("./song-settings"));

export default function Library() {
  const state = useLibrary();
  const { fileImport, online, processing, recordings } = state;
  return (
    <Stack align="center" sx={{ position: "relative" }}>
      <LibraryBackdrop />
      <Stack sx={{ paddingInline: "var(--library-gutter)", position: "relative" }}>
        <LibraryHero
          songCount={state.totalCount}
          readyCount={state.readyCount}
          canManageLibrary={state.canManageLibrary}
          importing={fileImport.importing}
          onFileChosen={fileImport.importFile}
          fileInputRef={state.fileInputRef}
          onAdd={fileImport.openFilePicker}
          onOpenRoom={online.openRoom}
          roomActive={online.roomActive}
          query={state.query}
          setQuery={state.setQuery}
          filters={state.filters}
          filterOptions={state.filterOptions}
          setFilters={state.setFilters}
        />
        <LibraryResults
          error={state.songsError}
          onFileChosen={fileImport.importFile}
          fileInputRef={state.fileInputRef}
          importing={fileImport.importing}
          canManageLibrary={state.canManageLibrary}
          songs={state.filteredSongs}
          errorText={`${tr("Не удалось загрузить список:")} ${state.songsError?.message || state.songsError || ""}`}
        >
          <SongGrid
            songs={state.filteredSongs}
            canManageLibrary={state.canManageLibrary}
            transferStatuses={state.transferStatuses}
            onOpenKaraoke={state.openKaraoke}
            onOpenProcessing={processing.track}
            onOpenRecordings={recordings.setSong}
            onOpenSettings={state.setSettingsSongId}
            onDelete={state.songActions.deleteSong}
            onOpenFolder={state.songActions.openSongFolder}
            onProcess={state.songActions.processSong}
            onReprocess={state.songActions.reprocessSong}
          />
        </LibraryResults>
      </Stack>
      <Box
        aria-hidden="true"
        sx={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          pointerEvents: "none",
          background: "#000",
          opacity: state.transitioning ? 1 : 0,
          transition: "opacity 180ms ease"
        }}
      />
      {online.open && (
        <OnlineRoomModal
          onlineName={online.name}
          onOnlineNameChange={online.setName}
          onClose={() => online.setOpen(false)}
        />
      )}
      <RecordingsModal
        song={recordings.song}
        recordings={recordings.items}
        error={recordings.error}
        onClose={() => recordings.setSong(null)}
        onDelete={recordings.delete}
        onAnalyze={(recording) => {
          state.setAnalysis({
            analysisRecordingId: recording.id,
            analysisRecordings: recordings.items
          });
          recordings.setSong(null);
        }}
      />
      <AddSongsModal
        review={fileImport.review}
        onCancel={fileImport.cancelDraft}
        onConfirm={fileImport.confirmDraft}
        onUpdate={fileImport.updateDraft}
      />
      {state.settingsSongId && (
        <Suspense fallback={null}>
          <SongSettings
            songId={state.settingsSongId}
            onClose={() => state.setSettingsSongId(null)}
          />
        </Suspense>
      )}
      {state.analysis.analysisRecordingId && (
        <PerformanceAnalysisModal
          recordingId={state.analysis.analysisRecordingId}
          recordings={state.analysis.analysisRecordings}
          onClose={state.closeAnalysis}
          onDone={state.closeAnalysis}
          onDeleted={state.closeAnalysis}
        />
      )}
      {!fileImport.review && (
        <ProcessingModal
          song={processing.song}
          songs={processing.songs}
          status={processing.status}
          onSelectSong={processing.track}
          onClose={processing.close}
          onCancel={processing.cancel}
          onOpenKaraoke={(songId) => state.navigate("/karaoke", { state: { songId } })}
        />
      )}
    </Stack>
  );
}
