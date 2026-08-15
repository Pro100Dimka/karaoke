import { useEffect } from "react";
import {
  isEditableHotkeyTarget,
  isHotkeyScopeActive
} from "../../../../utils/hotkeys";

export default function useMelodyEditorHotkeys({
  clearSelection,
  copySelected,
  deleteSelected,
  duplicateSelected,
  duration,
  nudgeSelected,
  pasteNotes,
  pause,
  play,
  playing,
  redo,
  saveRef,
  seek,
  selectAdjacentNote,
  selectAll,
  selectedCount,
  undo,
  workspaceRef
}) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !isHotkeyScopeActive(workspaceRef.current)
      )
        return;

      const editable = isEditableHotkeyTarget(event.target);
      const mod = event.ctrlKey || event.metaKey;
      const { code, key } = event;
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      };
      const run = (action) => {
        consume();
        action();
      };

      if (mod && code === "KeyZ") {
        run(event.shiftKey ? redo : undo);
        return;
      }
      if (mod && code === "KeyY") {
        run(redo);
        return;
      }
      if (mod && code === "KeyS") {
        run(() => saveRef.current?.());
        return;
      }
      if (!editable && mod && code === "KeyA") {
        run(selectAll);
        return;
      }
      if (!editable && mod && code === "KeyC") {
        run(copySelected);
        return;
      }
      if (!editable && mod && code === "KeyX") {
        run(() => {
          copySelected();
          deleteSelected();
        });
        return;
      }
      if (!editable && mod && code === "KeyV") {
        run(pasteNotes);
        return;
      }
      if (!editable && mod && code === "KeyD") {
        run(duplicateSelected);
        return;
      }
      if (editable) return;
      if (code === "Space") {
        run(playing ? pause : play);
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        run(deleteSelected);
        return;
      }
      if (key === "Escape") {
        if (selectedCount) run(clearSelection);
        return;
      }
      if (key === "Home") {
        run(() => seek(0));
        return;
      }
      if (key === "End") {
        run(() => seek(duration));
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        const direction = key === "ArrowRight" ? 1 : -1;
        run(() => {
          if (mod)
            nudgeSelected(direction * (event.shiftKey ? 0.25 : 0.05), 0);
          else selectAdjacentNote(direction);
        });
        return;
      }
      if (!selectedCount) return;
      if (key === "ArrowUp") {
        run(() => nudgeSelected(0, event.shiftKey ? 12 : 1));
        return;
      }
      if (key === "ArrowDown") run(() => nudgeSelected(0, event.shiftKey ? -12 : -1));
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    clearSelection,
    copySelected,
    deleteSelected,
    duplicateSelected,
    duration,
    nudgeSelected,
    pasteNotes,
    pause,
    play,
    playing,
    redo,
    saveRef,
    seek,
    selectAdjacentNote,
    selectAll,
    selectedCount,
    undo,
    workspaceRef
  ]);
}
