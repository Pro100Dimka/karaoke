import {
  ArrowLeft,
  Crosshair,
  Merge,
  MoveHorizontal,
  MoveVertical,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../../../api/client";
import { useAppDialog } from "../../../../contexts/AppDialog";
import { translateSaved } from "../../../../i18n/runtime";
import EffectDial from "../../../Karaoke/components/console/effect-dial";
import SongStrip from "../../../Karaoke/components/console/song-strip";

import MelodyEditorHeader from "./melody-editor-header";
import MelodyEditorToolbarButton from "./melody-editor-toolbar";
import useMelodyEditorTransport from "./useMelodyEditorTransport";
import useMelodyEditorEditing from "./useMelodyEditorEditing";
import useMelodyEditorDocument from "./useMelodyEditorDocument";
import useMelodyEditorLayout from "./useMelodyEditorLayout";
import useMelodyEditorPreferences from "./useMelodyEditorPreferences";
import {
  BLACK_KEYS,
  clamp,
  noteName,
  useEditorHistory
} from "./melody-editor-state";

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
  const { loading, payload, restoreAi, save, saving } =
    useMelodyEditorDocument({
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
  } = useMelodyEditorTransport({
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
  } = useMelodyEditorEditing({
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
  const selectedNote = notes.find((note) => note._id === selected[0]);
  return (
    <section
      ref={workspaceRef}
      className="melody-editor-workspace"
      aria-label={translateSaved("Редактор мелодии {0}", {
        0: song?.title || ""
      })}
    >
      <MelodyEditorHeader
        duration={duration}
        selectedCount={selected.length}
        songTitle={song?.title}
        time={time}
      />

      {loading ? (
        <div className="melody-editor-loading">
          {translateSaved("Загружаем SongMap…")}
        </div>
      ) : (
        <div className="melody-editor-layout">
          <div className="melody-editor-stage">
            <div className="melody-editor-topdeck melody-editor-topdeck-v11">
              <div
                className="melody-editor-action-groups"
                role="toolbar"
                aria-label={translateSaved("Инструменты редактора")}
              >
                <div className="melody-editor-tool-group is-nav">
                  <MelodyEditorToolbarButton
                    icon={ArrowLeft}
                    label={translateSaved("Назад")}
                    tone="neutral"
                    onClick={() => {
                      pause();
                      onClose?.();
                    }}
                  />
                  <MelodyEditorToolbarButton
                    icon={Save}
                    label={
                      saving
                        ? translateSaved("Сохранение…")
                        : translateSaved("Сохранить")
                    }
                    disabled={saving}
                    tone="pink"
                    active
                    onClick={save}
                  />
                </div>
                <div className="melody-editor-tool-group is-history">
                  <MelodyEditorToolbarButton
                    icon={Undo2}
                    label={translateSaved("Отменить")}
                    tone="blue"
                    onClick={undo}
                  />
                  <MelodyEditorToolbarButton
                    icon={Redo2}
                    label={translateSaved("Вернуть отменённое")}
                    tone="blue"
                    onClick={redo}
                  />
                </div>
                <div className="melody-editor-tool-group is-ai">
                  {payload?.ai_backup_exists && (
                    <MelodyEditorToolbarButton
                      icon={RotateCcw}
                      label={translateSaved("Вернуть результат AI")}
                      tone="amber"
                      onClick={restoreAi}
                    />
                  )}
                  <MelodyEditorToolbarButton
                    icon={Crosshair}
                    label={
                      autoScroll
                        ? translateSaved("Автопрокрутка включена")
                        : translateSaved("Автопрокрутка выключена")
                    }
                    tone="cyan"
                    active={autoScroll}
                    onClick={toggleAutoScroll}
                  />
                </div>
                <div className="melody-editor-tool-group is-transport">
                  <MelodyEditorToolbarButton
                    icon={playing ? Pause : Play}
                    label={
                      playing
                        ? translateSaved("Стоп")
                        : translateSaved("Воспроизвести")
                    }
                    tone="green"
                    active={playing}
                    onClick={playing ? pause : play}
                  />
                  <label
                    className="melody-editor-speed"
                    htmlFor="melody-editor-playback-rate"
                  >
                    <span>{translateSaved("Скорость")}</span>
                    <select
                      id="melody-editor-playback-rate"
                      value={playbackRate}
                      onChange={(event) =>
                        setPlaybackRate(Number(event.target.value))
                      }
                    >
                      <option value="0.5">50%</option>
                      <option value="0.65">65%</option>
                      <option value="0.75">75%</option>
                      <option value="0.85">85%</option>
                      <option value="1">100%</option>
                    </select>
                  </label>
                </div>
                <div className="melody-editor-tool-group is-edit">
                  <MelodyEditorToolbarButton
                    icon={Merge}
                    label={translateSaved("Соединить выбранные")}
                    disabled={selected.length < 2}
                    tone="amber"
                    onClick={mergeSelected}
                  />
                  <MelodyEditorToolbarButton
                    icon={Trash2}
                    label={translateSaved("Удалить выбранные")}
                    disabled={!selected.length}
                    danger
                    tone="red"
                    onClick={deleteSelected}
                  />
                </div>
              </div>

              <div className="melody-editor-compact-dials">
                <EffectDial
                  label={translateSaved("Вокал")}
                  value={volumes.vocals}
                  onChange={(value) =>
                    setVolumes((v) => ({
                      ...v,
                      vocals: Number(value)
                    }))
                  }
                />
                <EffectDial
                  label={translateSaved("Мелодия")}
                  value={volumes.melody}
                  accent="secondary"
                  onChange={(value) =>
                    setVolumes((v) => ({
                      ...v,
                      melody: Number(value)
                    }))
                  }
                />
                <EffectDial
                  label={translateSaved("Минус")}
                  value={volumes.instrumental}
                  onChange={(value) =>
                    setVolumes((v) => ({
                      ...v,
                      instrumental: Number(value)
                    }))
                  }
                />
              </div>

              <div className="melody-editor-transport melody-editor-waveform-only">
                <SongStrip
                  song={song}
                  currentTime={time}
                  duration={duration}
                  onSeek={seek}
                />
              </div>

              <div
                className={`melody-editor-inline-selection ${selected.length ? "is-active" : ""}`}
              >
                {selectedNote ? (
                  <>
                    <strong>{noteName(selectedNote.midi_note)}</strong>
                    <span>
                      {selected.length > 1
                        ? translateSaved("{0} нот", {
                            0: selected.length
                          })
                        : translateSaved("{0}–{1}с", {
                            0: selectedNote.start.toFixed(2),
                            1: selectedNote.end.toFixed(2)
                          })}
                    </span>
                    <select
                      aria-label={translateSaved("Текст / слог")}
                      value={selectedNote.syllable_index ?? ""}
                      onChange={(event) => assignSyllable(event.target.value)}
                    >
                      <option value="">{translateSaved("Без текста")}</option>
                      {syllables.map((item) => (
                        <option key={item.index} value={item.index}>
                          {item.text} · #{item.index}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span>{translateSaved("Выберите ноту")}</span>
                )}
              </div>
            </div>
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

            <div
              ref={rollShellRef}
              className="melody-editor-roll-shell"
              onScroll={syncScrollState}
            >
              <div
                ref={rollCanvasRef}
                className="melody-editor-roll-canvas"
                style={{
                  width: laneWidth,
                  height: laneHeight
                }}
                onPointerDown={startMarquee}
                onPointerMove={(event) => {
                  drag(event);
                  updateMarquee(event);
                }}
                onPointerUp={(event) => {
                  endDrag();
                  endMarquee(event);
                }}
                onPointerCancel={(event) => {
                  endDrag();
                  endMarquee(event);
                }}
                onDoubleClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  seek((event.clientX - rect.left - keyboardWidth) / zoom);
                }}
              >
                {Array.from(
                  {
                    length: maxMidi - minMidi + 1
                  },
                  (_, idx) => {
                    const midi = maxMidi - idx;
                    const black = BLACK_KEYS.has(((midi % 12) + 12) % 12);
                    return (
                      <div
                        key={`row-${midi}`}
                        className={`melody-editor-pitch-row ${black ? "is-black" : "is-white"}`}
                        style={{
                          left: keyboardWidth,
                          top: idx * rowHeight,
                          height: rowHeight
                        }}
                      />
                    );
                  }
                )}

                <div
                  className="melody-editor-keyboard"
                  style={{
                    width: keyboardWidth,
                    height: laneHeight
                  }}
                >
                  {whiteKeyGeometry.map(({ midi, top, height }) => (
                    <div
                      key={`white-${midi}`}
                      className="melody-editor-piano-key is-white"
                      style={{
                        top,
                        width: keyboardWidth,
                        height
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        auditionNote(midi, 220);
                      }}
                    >
                      <span>{noteName(midi)}</span>
                    </div>
                  ))}
                  {Array.from(
                    {
                      length: maxMidi - minMidi + 1
                    },
                    (_, idx) => maxMidi - idx
                  )
                    .filter((midi) => BLACK_KEYS.has(((midi % 12) + 12) % 12))
                    .map((midi) => {
                      const center = (maxMidi - midi + 0.5) * rowHeight;
                      const height = rowHeight * 0.68;
                      return (
                        <div
                          key={`black-${midi}`}
                          className="melody-editor-piano-key is-black"
                          style={{
                            top: center - height / 2,
                            width: keyboardWidth * 0.64,
                            height
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            auditionNote(midi, 220);
                          }}
                        >
                          <span>{noteName(midi)}</span>
                        </div>
                      );
                    })}
                </div>
                <div
                  className="melody-editor-zero-time"
                  style={{
                    left: keyboardWidth
                  }}
                >
                  0:00
                </div>

                <div
                  className="melody-editor-lyrics-layer"
                  style={{ top: scrollState.top + 4 }}
                  aria-label={translateSaved("Слоги песни")}
                >
                  {lyricProjection.map((syllable) => (
                    <span
                      key={`lyric-${syllable.index}`}
                      className="melody-editor-lyric-fragment"
                      style={{
                        left: keyboardWidth + syllable.start * zoom,
                        width: Math.max(
                          1,
                          (syllable.end - syllable.start) * zoom
                        )
                      }}
                      title={`${syllable.text} · ${syllable.start.toFixed(3)}–${syllable.end.toFixed(3)}`}
                    >
                      <span>{syllable.text}</span>
                    </span>
                  ))}
                </div>

                {notes.map((note) => {
                  const top = (maxMidi - note.midi_note) * rowHeight + 1;
                  const left = keyboardWidth + note.start * zoom;
                  const width = Math.max(6, (note.end - note.start) * zoom);
                  const active = selected.includes(note._id);
                  return (
                    <div
                      key={note._id}
                      className={`melody-editor-note ${active ? "is-selected" : ""}`}
                      onPointerDown={(event) => startDrag(event, note, "move")}
                      style={{
                        left,
                        top,
                        width,
                        height: Math.max(8, rowHeight - 2)
                      }}
                      title={`${noteName(note.midi_note)} · ${note.start.toFixed(3)}–${note.end.toFixed(3)}`}
                    >
                      <span
                        className="melody-editor-note-handle is-left"
                        onPointerDown={(event) =>
                          startDrag(event, note, "left")
                        }
                      />
                      <span
                        className="melody-editor-note-handle is-right"
                        onPointerDown={(event) =>
                          startDrag(event, note, "right")
                        }
                      />
                    </div>
                  );
                })}

                {selectionBox && (
                  <div
                    className="melody-editor-selection-box"
                    style={{
                      left: Math.min(selectionBox.x1, selectionBox.x2),
                      top: Math.min(selectionBox.y1, selectionBox.y2),
                      width: Math.abs(selectionBox.x2 - selectionBox.x1),
                      height: Math.abs(selectionBox.y2 - selectionBox.y1)
                    }}
                  />
                )}

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

            <div
              className="melody-editor-cubase-scrollbar is-horizontal"
              aria-label={translateSaved("Горизонтальная прокрутка")}
            >
              <div
                className="melody-editor-scroll-track"
                onPointerDown={(event) => {
                  const shell = rollShellRef.current;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const max = Math.max(
                    1,
                    shell.scrollWidth - shell.clientWidth
                  );
                  shell.scrollLeft = clamp(
                    ((event.clientX - rect.left) / rect.width) * max,
                    0,
                    max
                  );
                  syncScrollState();
                }}
              >
                <span
                  className="melody-editor-scroll-thumb"
                  onPointerDown={(event) => startScrollThumbDrag(event, "x")}
                  onPointerMove={moveScrollThumbDrag}
                  onPointerUp={endScrollThumbDrag}
                  onPointerCancel={endScrollThumbDrag}
                  style={{
                    width: `${Math.max(7, (scrollState.clientWidth / scrollState.scrollWidth) * 100)}%`,
                    left: `${(scrollState.left / Math.max(1, scrollState.scrollWidth - scrollState.clientWidth)) * Math.max(0, 100 - Math.max(7, (scrollState.clientWidth / scrollState.scrollWidth) * 100))}%`
                  }}
                />
              </div>
              <label
                htmlFor="melody-editor-horizontal-zoom"
                className="melody-editor-inline-zoom"
                title={translateSaved(
                  "Горизонтальный масштаб · Ctrl+Shift+колесо"
                )}
              >
                <MoveHorizontal size={12} />
                <input
                  id="melody-editor-horizontal-zoom"
                  type="range"
                  min="36"
                  max="600"
                  step="1"
                  value={zoom}
                  onChange={(event) =>
                    setHorizontalZoomAnchored(Number(event.target.value))
                  }
                />
              </label>
            </div>
            <div
              className="melody-editor-cubase-scrollbar is-vertical"
              aria-label={translateSaved("Вертикальная прокрутка")}
            >
              <div
                className="melody-editor-scroll-track"
                onPointerDown={(event) => {
                  const shell = rollShellRef.current;
                  const rect = event.currentTarget.getBoundingClientRect();
                  const max = Math.max(
                    1,
                    shell.scrollHeight - shell.clientHeight
                  );
                  shell.scrollTop = clamp(
                    ((event.clientY - rect.top) / rect.height) * max,
                    0,
                    max
                  );
                  syncScrollState();
                }}
              >
                <span
                  className="melody-editor-scroll-thumb"
                  onPointerDown={(event) => startScrollThumbDrag(event, "y")}
                  onPointerMove={moveScrollThumbDrag}
                  onPointerUp={endScrollThumbDrag}
                  onPointerCancel={endScrollThumbDrag}
                  style={{
                    height: `${Math.max(7, (scrollState.clientHeight / scrollState.scrollHeight) * 100)}%`,
                    top: `${(scrollState.top / Math.max(1, scrollState.scrollHeight - scrollState.clientHeight)) * Math.max(0, 100 - Math.max(7, (scrollState.clientHeight / scrollState.scrollHeight) * 100))}%`
                  }}
                />
              </div>
              <label
                htmlFor="melody-editor-vertical-zoom"
                className="melody-editor-inline-zoom is-vertical"
                title={translateSaved("Вертикальный масштаб · Ctrl+колесо")}
              >
                <MoveVertical size={12} />
                <input
                  id="melody-editor-vertical-zoom"
                  type="range"
                  min="10"
                  max="36"
                  step="1"
                  value={verticalZoom}
                  onChange={(event) =>
                    setVerticalZoomAnchored(Number(event.target.value))
                  }
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
