import { translateSaved } from "../../../../i18n/runtime";

export default function MelodyEditorHeader({ duration, selectedCount, songTitle, time }) {
  return (
    <header className="melody-editor-header">
      <div className="melody-editor-title-block">
        <span className="melody-editor-eyebrow">
          {songTitle || translateSaved("Песня")} · VOCAL MELODY EDITOR
        </span>
      </div>
      <div className="melody-editor-statusline">
        <span className="melody-editor-status-pill">
          {selectedCount
            ? translateSaved("Выбрано {0}", { 0: selectedCount })
            : translateSaved("Готов к редактированию")}
        </span>
        <span className="melody-editor-timecode">
          {time.toFixed(2)} / {duration.toFixed(2)}
          {translateSaved("сек")}
        </span>
      </div>
    </header>
  );
}
