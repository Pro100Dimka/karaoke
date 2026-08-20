import { MoveHorizontal, MoveVertical } from "lucide-react";
import { translateSaved } from "../../../../i18n/runtime";
import { BLACK_KEYS, clamp, noteName } from "./melody-editor-state";

const thumbSize = (viewport, content) => Math.max(7, (viewport / Math.max(1, content)) * 100);
const thumbOffset = (position, viewport, content) => {
  const size = thumbSize(viewport, content);
  return (position / Math.max(1, content - viewport)) * Math.max(0, 100 - size);
};

function PianoKeyboard({
  auditionNote,
  keyboardWidth,
  laneHeight,
  maxMidi,
  minMidi,
  rowHeight,
  whiteKeyGeometry
}) {
  const blackKeys = Array.from(
    { length: maxMidi - minMidi + 1 },
    (_, index) => maxMidi - index
  ).filter((midi) => BLACK_KEYS.includes(((midi % 12) + 12) % 12));
  const audition = (event, midi) => {
    event.stopPropagation();
    auditionNote(midi, 220);
  };
  return (
    <div className="melody-editor-keyboard" style={{ width: keyboardWidth, height: laneHeight }}>
      {whiteKeyGeometry.map(({ midi, top, height }) => (
        <div
          key={`white-${midi}`}
          className="melody-editor-piano-key is-white"
          style={{ top, width: keyboardWidth, height }}
          onPointerDown={(event) => audition(event, midi)}
        >
          <span>{noteName(midi)}</span>
        </div>
      ))}
      {blackKeys.map((midi) => {
        const center = (maxMidi - midi + 0.5) * rowHeight;
        const height = rowHeight * 0.68;
        return (
          <div
            key={`black-${midi}`}
            className="melody-editor-piano-key is-black"
            style={{ top: center - height / 2, width: keyboardWidth * 0.64, height }}
            onPointerDown={(event) => audition(event, midi)}
          >
            <span>{noteName(midi)}</span>
          </div>
        );
      })}
    </div>
  );
}

function PitchRows({ keyboardWidth, maxMidi, minMidi, rowHeight }) {
  return Array.from({ length: maxMidi - minMidi + 1 }, (_, index) => {
    const midi = maxMidi - index;
    const black = BLACK_KEYS.includes(((midi % 12) + 12) % 12);
    return (
      <div
        key={`row-${midi}`}
        className={`melody-editor-pitch-row ${black ? "is-black" : "is-white"}`}
        style={{ left: keyboardWidth, top: index * rowHeight, height: rowHeight }}
      />
    );
  });
}

function LyricsLayer({ keyboardWidth, lyricProjection, scrollTop, zoom }) {
  return (
    <div
      className="melody-editor-lyrics-layer"
      style={{ top: scrollTop + 4 }}
      aria-label={translateSaved("Слова песни")}
    >
      {lyricProjection.map((word) => (
        <span
          key={`lyric-${word.index}`}
          className="melody-editor-lyric-fragment"
          style={{
            left: keyboardWidth + word.start * zoom,
            width: Math.max(1, (word.end - word.start) * zoom)
          }}
          title={`${word.text} · ${word.start.toFixed(3)}–${word.end.toFixed(3)}`}
        >
          <span>{word.text}</span>
        </span>
      ))}
    </div>
  );
}

function NotesLayer({ maxMidi, notes, rowHeight, selected, startDrag, zoom, keyboardWidth }) {
  return notes.map((note) => {
    const top = (maxMidi - note.note) * rowHeight + 1;
    const left = keyboardWidth + note.start * zoom;
    const width = Math.max(6, (note.end - note.start) * zoom);
    const active = selected.includes(note._id);
    return (
      <div
        key={note._id}
        className={`melody-editor-note ${active ? "is-selected" : ""}`}
        onPointerDown={(event) => startDrag(event, note, "move")}
        style={{ left, top, width, height: Math.max(8, rowHeight - 2) }}
        title={`${noteName(note.note)} · ${note.start.toFixed(3)}–${note.end.toFixed(3)}`}
      >
        <span
          className="melody-editor-note-handle is-left"
          onPointerDown={(event) => startDrag(event, note, "left")}
        />
        <span
          className="melody-editor-note-handle is-right"
          onPointerDown={(event) => startDrag(event, note, "right")}
        />
      </div>
    );
  });
}

function SelectionBox({ value }) {
  if (!value) return null;
  return (
    <div
      className="melody-editor-selection-box"
      style={{
        left: Math.min(value.x1, value.x2),
        top: Math.min(value.y1, value.y2),
        width: Math.abs(value.x2 - value.x1),
        height: Math.abs(value.y2 - value.y1)
      }}
    />
  );
}

function Scrollbar({
  axis,
  endScrollThumbDrag,
  moveScrollThumbDrag,
  rollShellRef,
  scrollState,
  startScrollThumbDrag,
  syncScrollState
}) {
  const horizontal = axis === "x";
  const viewport = horizontal ? scrollState.clientWidth : scrollState.clientHeight;
  const content = horizontal ? scrollState.scrollWidth : scrollState.scrollHeight;
  const position = horizontal ? scrollState.left : scrollState.top;
  const size = thumbSize(viewport, content);
  const offset = thumbOffset(position, viewport, content);
  const jump = (event) => {
    const shell = rollShellRef.current;
    if (!shell) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const span = horizontal ? rect.width : rect.height;
    if (!span) return;
    const pointer = horizontal ? event.clientX - rect.left : event.clientY - rect.top;
    const max = Math.max(
      0,
      horizontal ? shell.scrollWidth - shell.clientWidth : shell.scrollHeight - shell.clientHeight
    );
    const next = clamp((pointer / span) * max, 0, max);
    if (horizontal) shell.scrollLeft = next;
    else shell.scrollTop = next;
    syncScrollState();
  };
  return (
    <div className="melody-editor-scroll-track" onPointerDown={jump}>
      <span
        className="melody-editor-scroll-thumb"
        onPointerDown={(event) => startScrollThumbDrag(event, axis)}
        onPointerMove={moveScrollThumbDrag}
        onPointerUp={endScrollThumbDrag}
        onPointerCancel={endScrollThumbDrag}
        style={
          horizontal
            ? { width: `${size}%`, left: `${offset}%` }
            : { height: `${size}%`, top: `${offset}%` }
        }
      />
    </div>
  );
}

function ZoomControl({ axis, setZoom, value }) {
  const horizontal = axis === "x";
  const id = `melody-editor-${horizontal ? "horizontal" : "vertical"}-zoom`;
  return (
    <label
      htmlFor={id}
      className={`melody-editor-inline-zoom${horizontal ? "" : " is-vertical"}`}
      title={
        horizontal
          ? translateSaved("Горизонтальный масштаб · Ctrl+Shift+колесо")
          : translateSaved("Вертикальный масштаб · Ctrl+колесо")
      }
    >
      {horizontal ? <MoveHorizontal size={12} /> : <MoveVertical size={12} />}
      <input
        id={id}
        type="range"
        min={horizontal ? 36 : 10}
        max={horizontal ? 600 : 36}
        step="1"
        value={value}
        onChange={(event) => setZoom(Number(event.target.value))}
      />
    </label>
  );
}

function EditorScrollbar(props) {
  const { axis } = props;
  const horizontal = axis === "x";
  return (
    <div
      className={`melody-editor-cubase-scrollbar is-${horizontal ? "horizontal" : "vertical"}`}
      aria-label={
        horizontal
          ? translateSaved("Горизонтальная прокрутка")
          : translateSaved("Вертикальная прокрутка")
      }
    >
      <Scrollbar {...props} />
      <ZoomControl
        axis={axis}
        setZoom={horizontal ? props.setHorizontalZoomAnchored : props.setVerticalZoomAnchored}
        value={horizontal ? props.zoom : props.verticalZoom}
      />
    </div>
  );
}

export default function MelodyEditorRoll({
  auditionNote,
  drag,
  duration,
  endDrag,
  endMarquee,
  endPlayheadDrag,
  endScrollThumbDrag,
  keyboardWidth,
  laneHeight,
  laneWidth,
  lyricProjection,
  maxMidi,
  minMidi,
  movePlayheadDrag,
  moveScrollThumbDrag,
  notes,
  rollCanvasRef,
  rollShellRef,
  rowHeight,
  scrollState,
  seek,
  selected,
  selectionBox,
  setHorizontalZoomAnchored,
  setVerticalZoomAnchored,
  startDrag,
  startMarquee,
  startPlayheadDrag,
  startScrollThumbDrag,
  syncScrollState,
  time,
  updateMarquee,
  verticalZoom,
  whiteKeyGeometry,
  zoom
}) {
  const endPointerAction = (event) => {
    endDrag();
    endMarquee(event);
  };
  return (
    <>
      <div ref={rollShellRef} className="melody-editor-roll-shell" onScroll={syncScrollState}>
        <div
          ref={rollCanvasRef}
          className="melody-editor-roll-canvas"
          style={{ width: laneWidth, height: laneHeight }}
          onPointerDown={startMarquee}
          onPointerMove={(event) => {
            drag(event);
            updateMarquee(event);
          }}
          onPointerUp={endPointerAction}
          onPointerCancel={endPointerAction}
          onDoubleClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            seek((event.clientX - rect.left - keyboardWidth) / zoom);
          }}
        >
          <PitchRows
            keyboardWidth={keyboardWidth}
            maxMidi={maxMidi}
            minMidi={minMidi}
            rowHeight={rowHeight}
          />
          <PianoKeyboard
            auditionNote={auditionNote}
            keyboardWidth={keyboardWidth}
            laneHeight={laneHeight}
            maxMidi={maxMidi}
            minMidi={minMidi}
            rowHeight={rowHeight}
            whiteKeyGeometry={whiteKeyGeometry}
          />
          <div className="melody-editor-zero-time" style={{ left: keyboardWidth }}>
            0:00
          </div>
          <LyricsLayer
            keyboardWidth={keyboardWidth}
            lyricProjection={lyricProjection}
            scrollTop={scrollState.top}
            zoom={zoom}
          />
          <NotesLayer
            keyboardWidth={keyboardWidth}
            maxMidi={maxMidi}
            notes={notes}
            rowHeight={rowHeight}
            selected={selected}
            startDrag={startDrag}
            zoom={zoom}
          />
          <SelectionBox value={selectionBox} />
          <div
            className="melody-editor-playhead"
            role="slider"
            aria-label={translateSaved("Позиция воспроизведения")}
            aria-valuemin="0"
            aria-valuemax={duration}
            aria-valuenow={time}
            tabIndex={0}
            onPointerDown={startPlayheadDrag}
            onPointerMove={movePlayheadDrag}
            onPointerUp={endPlayheadDrag}
            onPointerCancel={endPlayheadDrag}
          >
            <span className="melody-editor-playhead-handle" />
          </div>
        </div>
      </div>
      {[
        ["x", zoom],
        ["y", verticalZoom]
      ].map(([axis]) => (
        <EditorScrollbar
          key={axis}
          axis={axis}
          endScrollThumbDrag={endScrollThumbDrag}
          moveScrollThumbDrag={moveScrollThumbDrag}
          rollShellRef={rollShellRef}
          scrollState={scrollState}
          setHorizontalZoomAnchored={setHorizontalZoomAnchored}
          setVerticalZoomAnchored={setVerticalZoomAnchored}
          startScrollThumbDrag={startScrollThumbDrag}
          syncScrollState={syncScrollState}
          verticalZoom={verticalZoom}
          zoom={zoom}
        />
      ))}
    </>
  );
}
