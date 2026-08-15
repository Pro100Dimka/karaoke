import { useRef, useState } from "react";
import { api } from "../../../../api/client";
import { useAppDialog } from "../../../../contexts/AppDialog";
import { translateSaved } from "../../../../i18n/runtime";
import MelodyEditorControls from "./melody-editor-controls";
import MelodyEditorHeader from "./melody-editor-header";
import MelodyEditorRoll from "./melody-editor-roll";
import useMelodyEditorDocument from "./useMelodyEditorDocument";
import useMelodyEditorEditing from "./useMelodyEditorEditing";
import useMelodyEditorLayout from "./useMelodyEditorLayout";
import useMelodyEditorPreferences from "./useMelodyEditorPreferences";
import useMelodyEditorTransport from "./useMelodyEditorTransport";
import { useEditorHistory } from "./melody-editor-state";

export default function MelodyEditor({ song, onClose, onSaved }) {
  const { alert: notify, confirm: confirmDialog } = useAppDialog();
  const [selected, setSelected] = useState([]);
  const {
    autoScroll,
    playbackRate,
    setAutoScroll,
    setPlaybackRate,
    setVerticalZoom,
    setVolumes,
    setZoom,
    verticalZoom,
    volumes,
    zoom
  } = useMelodyEditorPreferences();
  const { notes, replace, reset, remember, undo, redo } = useEditorHistory([]);
  const workspaceRef = useRef(null);
  const saveRef = useRef(null);
  const { loading, payload, restoreAi, save, saving } = useMelodyEditorDocument({
    confirmDialog,
    notes,
    notify,
    onSaved,
    reset,
    saveRef,
    setSelected,
    song
  });
  const {
    duration,
    keyboardWidth,
    laneHeight,
    laneWidth,
    lyricProjection,
    maxMidi,
    minMidi,
    noteAtTime,
    rowHeight,
    syllableByIndex,
    syllables,
    whiteKeyGeometry
  } = useMelodyEditorLayout({ notes, payload, verticalZoom, zoom });
  const transport = useMelodyEditorTransport({
    autoScroll,
    setAutoScroll,
    duration,
    keyboardWidth,
    laneHeight,
    laneWidth,
    maxMidi,
    minMidi,
    noteAtTime,
    notes,
    notify,
    playbackRate,
    setVerticalZoom,
    setZoom,
    verticalZoom,
    volumes,
    zoom
  });
  const {
    auditionNote,
    endPlayheadDrag,
    endScrollThumbDrag,
    handleInstrumentalPause,
    handleInstrumentalTimeUpdate,
    instrumentalRef,
    movePlayheadDrag,
    moveScrollThumbDrag,
    pause,
    play,
    playing,
    rollCanvasRef,
    rollShellRef,
    scrollState,
    seek,
    setHorizontalZoomAnchored,
    setVerticalZoomAnchored,
    startPlayheadDrag,
    startScrollThumbDrag,
    syncScrollState,
    time,
    toggleAutoScroll,
    vocalsRef
  } = transport;
  const editing = useMelodyEditorEditing({
    auditionNote,
    duration,
    keyboardWidth,
    maxMidi,
    notes,
    pause,
    play,
    playing,
    redo,
    remember,
    replace,
    rollCanvasRef,
    rowHeight,
    saveRef,
    seek,
    selected,
    setSelected,
    syllableByIndex,
    undo,
    workspaceRef,
    zoom
  });
  const {
    assignSyllable,
    deleteSelected,
    drag,
    endDrag,
    endMarquee,
    mergeSelected,
    selectionBox,
    startDrag,
    startMarquee,
    updateMarquee
  } = editing;
  const selectedNote = notes.find((note) => note._id === selected[0]);
  const onBack = () => {
    pause();
    onClose?.();
  };

  return (
    <section
      ref={workspaceRef}
      className="melody-editor-workspace"
      aria-label={translateSaved("Редактор мелодии {0}", { 0: song?.title || "" })}
    >
      <MelodyEditorHeader
        duration={duration}
        selectedCount={selected.length}
        songTitle={song?.title}
        time={time}
      />

      {loading ? (
        <div className="melody-editor-loading">{translateSaved("Загружаем SongMap…")}</div>
      ) : (
        <div className="melody-editor-layout">
          <div className="melody-editor-stage">
            <MelodyEditorControls
              assignSyllable={assignSyllable}
              autoScroll={autoScroll}
              deleteSelected={deleteSelected}
              duration={duration}
              mergeSelected={mergeSelected}
              onBack={onBack}
              payload={payload}
              pause={pause}
              play={play}
              playbackRate={playbackRate}
              playing={playing}
              redo={redo}
              restoreAi={restoreAi}
              save={save}
              saving={saving}
              seek={seek}
              selected={selected}
              selectedNote={selectedNote}
              setPlaybackRate={setPlaybackRate}
              setVolumes={setVolumes}
              song={song}
              syllables={syllables}
              time={time}
              toggleAutoScroll={toggleAutoScroll}
              undo={undo}
              volumes={volumes}
            />
            <audio
              ref={vocalsRef}
              preload="metadata"
              src={api.getAudioTrackUrl(song.id, "vocals")}
            />
            <audio
              ref={instrumentalRef}
              preload="metadata"
              src={api.getAudioTrackUrl(song.id, "instrumental")}
              onEnded={pause}
              onPause={handleInstrumentalPause}
              onTimeUpdate={handleInstrumentalTimeUpdate}
            />
            <MelodyEditorRoll
              auditionNote={auditionNote}
              drag={drag}
              duration={duration}
              endDrag={endDrag}
              endMarquee={endMarquee}
              endPlayheadDrag={endPlayheadDrag}
              endScrollThumbDrag={endScrollThumbDrag}
              keyboardWidth={keyboardWidth}
              laneHeight={laneHeight}
              laneWidth={laneWidth}
              lyricProjection={lyricProjection}
              maxMidi={maxMidi}
              minMidi={minMidi}
              movePlayheadDrag={movePlayheadDrag}
              moveScrollThumbDrag={moveScrollThumbDrag}
              notes={notes}
              rollCanvasRef={rollCanvasRef}
              rollShellRef={rollShellRef}
              rowHeight={rowHeight}
              scrollState={scrollState}
              seek={seek}
              selected={selected}
              selectionBox={selectionBox}
              setHorizontalZoomAnchored={setHorizontalZoomAnchored}
              setVerticalZoomAnchored={setVerticalZoomAnchored}
              startDrag={startDrag}
              startMarquee={startMarquee}
              startPlayheadDrag={startPlayheadDrag}
              startScrollThumbDrag={startScrollThumbDrag}
              syncScrollState={syncScrollState}
              time={time}
              updateMarquee={updateMarquee}
              verticalZoom={verticalZoom}
              whiteKeyGeometry={whiteKeyGeometry}
              zoom={zoom}
            />
          </div>
        </div>
      )}
    </section>
  );
}
