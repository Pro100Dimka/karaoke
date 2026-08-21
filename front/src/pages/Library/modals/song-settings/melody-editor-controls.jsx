import {
  ArrowLeft,
  Crosshair,
  Merge,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import { translateSaved } from "../../../../i18n/runtime";
import EffectDial from "../../../Karaoke/components/console/effect-dial";
import SongStrip from "../../../Karaoke/components/console/song-strip";
import { noteName } from "./melody-editor-state";
import MelodyEditorToolbarButton from "./melody-editor-toolbar";

const PLAYBACK_RATES = [0.5, 0.65, 0.75, 0.85, 1];

function EditorActions({
  autoScroll,
  canMerge,
  deleteSelected,
  mergeSelected,
  onBack,
  payload,
  pause,
  play,
  playing,
  redo,
  restoreAi,
  save,
  saving,
  selectedCount,
  toggleAutoScroll,
  undo
}) {
  return (
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
          onClick={onBack}
        />
        <MelodyEditorToolbarButton
          icon={Save}
          label={saving ? translateSaved("Сохранение…") : translateSaved("Сохранить")}
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
          label={playing ? translateSaved("Стоп") : translateSaved("Воспроизвести")}
          tone="green"
          active={playing}
          onClick={playing ? pause : play}
        />
      </div>
      <div className="melody-editor-tool-group is-edit">
        <MelodyEditorToolbarButton
          icon={Merge}
          label={translateSaved("Соединить выбранные")}
          disabled={!canMerge}
          tone="amber"
          onClick={mergeSelected}
        />
        <MelodyEditorToolbarButton
          icon={Trash2}
          label={translateSaved("Удалить выбранные")}
          disabled={!selectedCount}
          danger
          tone="red"
          onClick={deleteSelected}
        />
      </div>
    </div>
  );
}

function PlaybackRate({ playbackRate, setPlaybackRate }) {
  return (
    <label className="melody-editor-speed" htmlFor="melody-editor-playback-rate">
      <span>{translateSaved("Скорость")}</span>
      <select
        id="melody-editor-playback-rate"
        value={playbackRate}
        onChange={(event) => setPlaybackRate(Number(event.target.value))}
      >
        {PLAYBACK_RATES.map((rate) => (
          <option key={rate} value={rate}>
            {Math.round(rate * 100)}%
          </option>
        ))}
      </select>
    </label>
  );
}

function VolumeDials({ setVolumes, volumes }) {
  const setVolume = (key) => (value) =>
    setVolumes((current) => ({ ...current, [key]: Number(value) }));
  return (
    <div className="melody-editor-compact-dials">
      <EffectDial
        label={translateSaved("Вокал")}
        value={volumes.vocals}
        onChange={setVolume("vocals")}
      />
      <EffectDial
        label={translateSaved("Мелодия")}
        value={volumes.melody}
        accent="secondary"
        onChange={setVolume("melody")}
      />
      <EffectDial
        label={translateSaved("Минус")}
        value={volumes.instrumental}
        onChange={setVolume("instrumental")}
      />
    </div>
  );
}

function SelectionSummary({ selected, selectedNote }) {
  return (
    <div className={`melody-editor-inline-selection ${selected.length ? "is-active" : ""}`}>
      {selectedNote ? (
        <>
          <strong>{noteName(selectedNote.note)}</strong>
          <span>
            {selected.length > 1
              ? translateSaved("{0} нот", { 0: selected.length })
              : translateSaved("{0}–{1}с", {
                  0: selectedNote.start.toFixed(2),
                  1: selectedNote.end.toFixed(2)
                })}
          </span>
          <span>{selectedNote.word_text}</span>
        </>
      ) : (
        <span>{translateSaved("Выберите ноту")}</span>
      )}
    </div>
  );
}

export default function MelodyEditorControls({
  autoScroll,
  canMerge,
  deleteSelected,
  duration,
  mergeSelected,
  onBack,
  payload,
  pause,
  play,
  playbackRate,
  playing,
  redo,
  restoreAi,
  save,
  saving,
  seek,
  selected,
  selectedNote,
  setPlaybackRate,
  setVolumes,
  song,
  time,
  toggleAutoScroll,
  undo,
  volumes
}) {
  return (
    <div className="melody-editor-topdeck melody-editor-topdeck-v11">
      <EditorActions
        autoScroll={autoScroll}
        canMerge={canMerge}
        deleteSelected={deleteSelected}
        mergeSelected={mergeSelected}
        onBack={onBack}
        payload={payload}
        pause={pause}
        play={play}
        playing={playing}
        redo={redo}
        restoreAi={restoreAi}
        save={save}
        saving={saving}
        selectedCount={selected.length}
        toggleAutoScroll={toggleAutoScroll}
        undo={undo}
      />
      <PlaybackRate playbackRate={playbackRate} setPlaybackRate={setPlaybackRate} />
      <VolumeDials setVolumes={setVolumes} volumes={volumes} />
      <div className="melody-editor-transport melody-editor-waveform-only">
        <SongStrip song={song} currentTime={time} duration={duration} onSeek={seek} />
      </div>
      <SelectionSummary selected={selected} selectedNote={selectedNote} />
    </div>
  );
}
